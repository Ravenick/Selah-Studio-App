use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use if_addrs::IfAddr;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State as TauriState};
use tokio::{net::TcpListener, sync::oneshot};

const SESSION_LIFETIME_SECONDS: u64 = 60 * 60;
const DEVICE_ACTIVE_SECONDS: u64 = 120;
const SUBMISSION_WINDOW_SECONDS: u64 = 10 * 60;
const MAX_SUBMISSIONS_PER_DEVICE_WINDOW: usize = 10;
const MAX_INBOX_SUBMISSIONS: usize = 500;
const MAX_TITLE_LENGTH: usize = 120;
const MAX_CONTENT_LENGTH: usize = 20_000;
const MAX_NOTES_LENGTH: usize = 2_000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum SubmissionKind {
    Song,
    Sermon,
    Announcement,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IncomingSubmission {
    id: String,
    title: String,
    kind: SubmissionKind,
    content: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    scripture_references: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    sender_name: String,
    #[serde(default)]
    device_id: String,
    submitted_at: u64,
    status: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmissionRequest {
    id: String,
    title: String,
    kind: SubmissionKind,
    content: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    scripture_references: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    sender_name: String,
    device_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresenceRequest {
    device_id: String,
}

#[derive(Clone, Debug, Deserialize)]
struct PairingQuery {
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WifiStatus {
    running: bool,
    address: Option<String>,
    expires_at: Option<u64>,
    connected_devices: usize,
    active_transfers: usize,
    failed_submissions: usize,
    incoming_count: usize,
    pending_count: usize,
}

struct Session {
    address: String,
    token: String,
    expires_at: u64,
    stop: Option<oneshot::Sender<()>>,
}

#[derive(Default)]
struct ConnectData {
    session: Option<Session>,
    submissions: Vec<IncomingSubmission>,
    devices: HashMap<String, u64>,
    recent_submissions: HashMap<String, Vec<u64>>,
    active_transfers: usize,
    failed_submissions: usize,
}

type SharedState = Arc<Mutex<ConnectData>>;

#[derive(Clone)]
struct ServerState {
    shared: SharedState,
    app: Option<tauri::AppHandle>,
    submissions_path: PathBuf,
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn status_for(data: &mut ConnectData) -> WifiStatus {
    let now = now_seconds();
    let expired = data
        .session
        .as_ref()
        .is_some_and(|session| session.expires_at <= now);
    if expired {
        stop_session(data);
    }

    data.devices
        .retain(|_, last_seen| now.saturating_sub(*last_seen) <= DEVICE_ACTIVE_SECONDS);
    let running = data.session.is_some();
    WifiStatus {
        running,
        address: data.session.as_ref().map(|session| session.address.clone()),
        expires_at: data.session.as_ref().map(|session| session.expires_at),
        connected_devices: data.devices.len(),
        active_transfers: data.active_transfers,
        failed_submissions: data.failed_submissions,
        incoming_count: data.submissions.len(),
        pending_count: data
            .submissions
            .iter()
            .filter(|submission| submission.status == "pending")
            .count(),
    }
}

fn stop_session(data: &mut ConnectData) {
    if let Some(mut session) = data.session.take() {
        session.token.clear();
        if let Some(stop) = session.stop.take() {
            let _ = stop.send(());
        }
    }
    data.devices.clear();
}

fn is_private_ipv4(address: Ipv4Addr) -> bool {
    address.is_private() && !address.is_loopback() && !address.is_link_local()
}

fn discover_private_ipv4() -> Result<Ipv4Addr, String> {
    let interfaces = if_addrs::get_if_addrs()
        .map_err(|error| format!("Could not inspect network interfaces: {error}"))?;
    interfaces
        .into_iter()
        .find_map(|interface| match interface.addr {
            IfAddr::V4(address) if is_private_ipv4(address.ip) => Some(address.ip),
            _ => None,
        })
        .ok_or_else(|| {
            "No private Wi-Fi or LAN IPv4 address was found. Connect this computer and the sender device to the same Wi-Fi network or hotspot, then try again.".to_string()
        })
}

fn create_pairing_token() -> String {
    let mut bytes = [0_u8; 24];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn load_submissions(path: &PathBuf) -> Result<Vec<IncomingSubmission>, String> {
    let backup_path = path.with_extension("json.bak");
    let primary_contents = match fs::read(path) {
        Ok(contents) => Some(contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("Could not read the local inbox: {error}")),
    };
    if let Some(contents) = primary_contents {
        return serde_json::from_slice(&contents)
            .map_err(|error| format!("The local inbox file is damaged and could not be loaded: {error}"));
    }
    match fs::read(backup_path) {
        Ok(contents) => serde_json::from_slice(&contents)
            .map_err(|error| format!("The local inbox backup is damaged and could not be loaded: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("Could not read the local inbox backup: {error}")),
    }
}

fn persist_submissions(path: &PathBuf, submissions: &[IncomingSubmission]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Could not locate the local data folder.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the local inbox folder: {error}"))?;
    let temporary_path = path.with_extension("json.tmp");
    let contents = serde_json::to_vec_pretty(submissions)
        .map_err(|error| format!("Could not serialize incoming submissions: {error}"))?;
    fs::write(&temporary_path, contents)
        .map_err(|error| format!("Could not save the incoming submission: {error}"))?;
    let backup_path = path.with_extension("json.bak");
    if path.exists() {
        if backup_path.exists() {
            fs::remove_file(&backup_path)
                .map_err(|error| format!("Could not rotate the local inbox backup: {error}"))?;
        }
        fs::rename(path, &backup_path)
            .map_err(|error| format!("Could not protect the previous local inbox: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary_path, path) {
        if backup_path.exists() {
            let _ = fs::rename(&backup_path, path);
        }
        return Err(format!("Could not finalize the local inbox file: {error}"));
    }
    if backup_path.exists() {
        if let Err(error) = fs::remove_file(&backup_path) {
            eprintln!("The inbox was saved but its previous backup could not be removed: {error}");
        }
    }
    Ok(())
}

fn constant_time_equal(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let mut difference = left.len() ^ right.len();
    for index in 0..left.len().max(right.len()) {
        difference |= usize::from(
            left.get(index).copied().unwrap_or_default()
                ^ right.get(index).copied().unwrap_or_default(),
        );
    }
    difference == 0
}

fn valid_text(value: &str, maximum: usize, allow_empty: bool) -> bool {
    value.len() <= maximum
        && (allow_empty || !value.trim().is_empty())
        && !value.chars().any(|character| {
            character.is_control() && character != '\n' && character != '\r' && character != '\t'
        })
}

fn valid_identifier(value: &str) -> bool {
    (8..=80).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn active_session(data: &ConnectData, token: &str) -> bool {
    data.session.as_ref().is_some_and(|session| {
        session.expires_at > now_seconds() && constant_time_equal(&session.token, token)
    })
}

fn pairing_token(headers: &HeaderMap) -> Option<&str> {
    headers.get("x-pairing-token")?.to_str().ok()
}

fn authorization_error() -> Response {
    message_response(
        StatusCode::UNAUTHORIZED,
        "This Wi-Fi sharing session is invalid or has expired. Ask the studio operator for a new QR code.",
    )
}

fn message_response(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(serde_json::json!({ "message": message.into() }))).into_response()
}

async fn page(Query(query): Query<PairingQuery>, State(state): State<ServerState>) -> Response {
    let authorized = state
        .shared
        .lock()
        .map(|data| active_session(&data, &query.token))
        .unwrap_or(false);
    if !authorized {
        return authorization_error();
    }
    // LAN HTTP pages are not secure contexts, so use getRandomValues instead of randomUUID.
    let mobile_page = SUBMISSION_PAGE.replace(
        "crypto.randomUUID()",
        "Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('')",
    );
    let mut response = Response::new(Body::from(mobile_page));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"),
    );
    response
}

async fn presence(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(request): Json<PresenceRequest>,
) -> Response {
    let Some(token) = pairing_token(&headers) else {
        return authorization_error();
    };
    if !valid_identifier(&request.device_id) {
        return message_response(StatusCode::BAD_REQUEST, "Invalid device identifier.");
    }
    let Ok(mut data) = state.shared.lock() else {
        return message_response(StatusCode::INTERNAL_SERVER_ERROR, "The local sharing service is unavailable.");
    };
    if !active_session(&data, token) {
        return authorization_error();
    }
    data.devices.insert(request.device_id, now_seconds());
    StatusCode::NO_CONTENT.into_response()
}

struct TransferGuard(SharedState);

impl Drop for TransferGuard {
    fn drop(&mut self) {
        if let Ok(mut data) = self.0.lock() {
            data.active_transfers = data.active_transfers.saturating_sub(1);
        }
    }
}

async fn submit(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(request): Json<SubmissionRequest>,
) -> Response {
    let Some(token) = pairing_token(&headers) else {
        return authorization_error();
    };
    let Ok(mut data) = state.shared.lock() else {
        return message_response(StatusCode::INTERNAL_SERVER_ERROR, "The local sharing service is unavailable.");
    };
    if !active_session(&data, token) {
        return authorization_error();
    }
    if !valid_identifier(&request.id) || !valid_identifier(&request.device_id) {
        data.failed_submissions += 1;
        return message_response(StatusCode::BAD_REQUEST, "Invalid submission or device identifier.");
    }
    if !valid_text(&request.title, MAX_TITLE_LENGTH, false)
        || !valid_text(&request.content, MAX_CONTENT_LENGTH, false)
        || !valid_text(&request.author, 120, true)
        || !valid_text(&request.scripture_references, 500, true)
        || !valid_text(&request.notes, MAX_NOTES_LENGTH, true)
        || !valid_text(&request.sender_name, 80, true)
    {
        data.failed_submissions += 1;
        return message_response(StatusCode::BAD_REQUEST, "Check the form: required fields cannot be blank, and one or more fields exceed the allowed length.");
    }
    if let Some(existing) = data
        .submissions
        .iter()
        .find(|submission| submission.id == request.id)
    {
        return (StatusCode::OK, Json(existing.clone())).into_response();
    }
    if let Some(existing) = data.submissions.iter().find(|submission| {
        submission.device_id == request.device_id
            && now_seconds().saturating_sub(submission.submitted_at) <= 120
            && submission.kind == request.kind
            && submission.title == request.title.trim()
            && submission.content == request.content
            && submission.author == request.author.trim()
            && submission.scripture_references == request.scripture_references.trim()
            && submission.notes == request.notes.trim()
            && submission.sender_name == request.sender_name.trim()
    }) {
        return (StatusCode::OK, Json(existing.clone())).into_response();
    }
    if data.submissions.len() >= MAX_INBOX_SUBMISSIONS {
        data.failed_submissions += 1;
        return message_response(
            StatusCode::TOO_MANY_REQUESTS,
            "The local inbox is full. Review or delete older submissions before receiving more.",
        );
    }
    let now = now_seconds();
    let recent_count = {
        let recent = data
            .recent_submissions
            .entry(request.device_id.clone())
            .or_default();
        recent.retain(|submitted_at| now.saturating_sub(*submitted_at) < SUBMISSION_WINDOW_SECONDS);
        recent.len()
    };
    if recent_count >= MAX_SUBMISSIONS_PER_DEVICE_WINDOW {
        data.failed_submissions += 1;
        return message_response(
            StatusCode::TOO_MANY_REQUESTS,
            "This device has sent several submissions recently. Please wait a few minutes before trying again.",
        );
    }

    data.active_transfers += 1;
    data.devices
        .insert(request.device_id.clone(), now_seconds());
    let _transfer = TransferGuard(state.shared.clone());
    let submission = IncomingSubmission {
        id: request.id,
        title: request.title.trim().to_string(),
        kind: request.kind,
        content: request.content,
        author: request.author.trim().to_string(),
        scripture_references: request.scripture_references.trim().to_string(),
        notes: request.notes.trim().to_string(),
        sender_name: request.sender_name.trim().to_string(),
        device_id: request.device_id.clone(),
        submitted_at: now,
        status: "pending".to_string(),
    };
    data.submissions.push(submission.clone());
    if let Err(error) = persist_submissions(&state.submissions_path, &data.submissions) {
        data.submissions.pop();
        data.failed_submissions += 1;
        return message_response(StatusCode::INTERNAL_SERVER_ERROR, error);
    }
    data.recent_submissions
        .entry(request.device_id)
        .or_default()
        .push(now);
    drop(data);
    if let Some(app) = &state.app {
        if let Err(error) = app.emit("wifi-submission-received", &submission.id) {
            eprintln!("Could not notify the studio about an incoming submission: {error}");
        }
    }
    (StatusCode::CREATED, Json(submission)).into_response()
}

const SUBMISSION_PAGE: &str = r##"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#07130f"><title>Send to Selah Studio</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#06110e;color:#edf8f1;font-synthesis:none}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 50% -10%,#245440 0,transparent 52%),radial-gradient(ellipse at 100% 80%,#102b24 0,transparent 40%),#06110e}.shell{width:min(720px,100%);margin:0 auto;padding:clamp(18px,5vw,42px) 18px 48px}.brand{display:flex;align-items:center;gap:12px;margin-bottom:32px}.mark{width:42px;height:42px;border:1px solid #6be4ad55;background:linear-gradient(145deg,#38a97944,#10201b);display:grid;place-items:center;border-radius:14px;color:#7ce6b6;box-shadow:0 0 32px #31d89124}.brand b{display:block;letter-spacing:.14em;font-size:12px}.brand span{display:block;color:#86a398;font-size:11px;margin-top:3px}.hero{margin-bottom:20px;animation:rise .55s cubic-bezier(.2,.8,.2,1) both}.eyebrow{color:#7ce6b6;font-size:10px;font-weight:800;letter-spacing:.2em;text-transform:uppercase}.hero h1{font-size:clamp(26px,7vw,38px);letter-spacing:-.04em;margin:8px 0}.hero p{margin:0;color:#9eb8ac;font-size:14px;line-height:1.55}.card{position:relative;overflow:hidden;border:1px solid #d6ffe719;background:linear-gradient(145deg,#12231edc,#091512e8);border-radius:24px;padding:clamp(16px,4vw,28px);box-shadow:0 28px 80px #0007;animation:rise .65s .08s cubic-bezier(.2,.8,.2,1) both}.card:before{content:"";position:absolute;inset:0 auto auto 15%;width:70%;height:1px;background:linear-gradient(90deg,transparent,#8ff4c499,transparent)}.types{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:22px}.type{border:1px solid #d6ffe71c;background:#0a1713;color:#aac0b5;border-radius:13px;padding:12px 6px;font-weight:750;cursor:pointer;transition:transform .2s,border .2s,background .2s}.type:hover{transform:translateY(-2px)}.type[aria-pressed=true]{color:#a0f4c8;border-color:#5de4a477;background:#17372b;box-shadow:inset 0 0 22px #45d38c12}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field{display:flex;flex-direction:column;gap:7px}.wide{grid-column:1/-1}label{font-size:11px;color:#c1d5ca;font-weight:700}input,textarea{width:100%;border:1px solid #d6ffe71d;background:#07110e;color:#f4fff8;border-radius:12px;padding:12px 13px;font:inherit;font-size:14px;outline:none;transition:border .2s,box-shadow .2s}textarea{min-height:110px;resize:vertical;line-height:1.55}input:focus,textarea:focus{border-color:#68dfa1aa;box-shadow:0 0 0 3px #68dfa11a}input::placeholder,textarea::placeholder{color:#62796e}.counter{align-self:flex-end;color:#667e72;font-size:10px;margin-top:-3px}.hint{color:#809a8c;font-size:11px;line-height:1.45;margin-top:2px}.preview{display:none;margin-top:20px;border:1px solid #7be8ad33;background:#10241b;border-radius:15px;padding:16px;animation:rise .25s ease both}.preview.show{display:block}.preview h3{margin:0 0 9px;color:#9cecc0;font-size:12px}.preview pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 inherit;color:#e3f2e9;margin:0}.actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px}.btn{border:0;border-radius:12px;padding:13px 18px;font-weight:800;cursor:pointer;transition:transform .18s,filter .18s}.btn:hover{transform:translateY(-1px);filter:brightness(1.08)}.btn:disabled{opacity:.6;cursor:wait;transform:none}.primary{background:linear-gradient(115deg,#5fe09e,#98ecc0);color:#082017;box-shadow:0 8px 28px #40ca851f}.secondary{background:#ffffff0b;border:1px solid #ffffff19;color:#d9ebe1}.message{display:none;margin-top:16px;border-radius:12px;padding:13px;font-size:13px;line-height:1.5}.message.show{display:block;animation:rise .22s ease both}.success{background:#2bad6a1a;border:1px solid #68e4a344;color:#a6f1c5}.error{background:#c3484818;border:1px solid #ff7b7b44;color:#ffc1c1}.offline{display:flex;gap:8px;align-items:center;color:#739182;font-size:11px;margin-top:16px}.dot{width:7px;height:7px;border-radius:50%;background:#71e4a2;box-shadow:0 0 12px #71e4a2aa}.foot{text-align:center;color:#536a5e;font-size:10px;margin-top:20px}@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@media(max-width:540px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}.types{gap:5px}.type{font-size:11px;padding:11px 3px}.actions{align-items:stretch;flex-direction:column-reverse}.actions .btn{width:100%}.hero{margin-bottom:17px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
</style></head>
<body><main class="shell"><div class="brand"><div class="mark" aria-hidden="true">✦</div><div><b>SELAH STUDIO</b><span>Private local submission</span></div></div><header class="hero"><div class="eyebrow">Connected to your church studio</div><h1>Share something meaningful.</h1><p>Send a song, sermon, or announcement to the studio team for review. Your submission stays on their computer.</p></header><form class="card" id="form"><div class="types" role="group" aria-label="Submission type"><button class="type" type="button" data-kind="song" aria-pressed="true">♫ &nbsp;Song</button><button class="type" type="button" data-kind="sermon" aria-pressed="false">✧ &nbsp;Sermon</button><button class="type" type="button" data-kind="announcement" aria-pressed="false">◈ &nbsp;Announcement</button></div><div class="grid"><div class="field wide"><label for="title">Title <span aria-hidden="true">*</span></label><input id="title" maxlength="120" required placeholder="Give your submission a clear title"></div><div class="field wide"><label id="content-label" for="content">Lyrics <span aria-hidden="true">*</span></label><textarea id="content" maxlength="20000" required placeholder="Keep line breaks and formatting as you write..."></textarea><span class="counter" id="counter">0 / 20,000</span></div><div class="field" id="author-wrap"><label id="author-label" for="author">Author / composer</label><input id="author" maxlength="120" placeholder="Optional"></div><div class="field" id="references-wrap" hidden><label for="references">Scripture references</label><input id="references" maxlength="500" placeholder="e.g. Psalm 23; John 10:11"></div><div class="field wide"><label for="sender">Your name <span class="hint">(optional)</span></label><input id="sender" maxlength="80" autocomplete="name" placeholder="How should the team identify you?"></div><div class="field wide"><label for="notes">Additional notes <span class="hint">(optional)</span></label><textarea id="notes" maxlength="2000" style="min-height:74px" placeholder="Anything else the team should know?"></textarea></div></div><div class="preview" id="preview"><h3>Submission preview</h3><div id="preview-title" style="font-weight:750;margin-bottom:7px"></div><pre id="preview-content"></pre></div><div class="actions"><button type="button" class="btn secondary" id="preview-button">Preview submission</button><button type="submit" class="btn primary" id="submit-button">Send to studio <span aria-hidden="true">→</span></button></div><div class="message" id="message" role="status" aria-live="polite"></div><div class="offline"><span class="dot"></span> Local Wi-Fi connection · No internet needed</div></form><div class="foot">Only the studio operator can approve a submission.</div></main>
<script>
(()=>{const q=new URLSearchParams(location.search),token=q.get("token")||"",form=document.querySelector("#form"),title=document.querySelector("#title"),content=document.querySelector("#content"),author=document.querySelector("#author"),references=document.querySelector("#references"),notes=document.querySelector("#notes"),sender=document.querySelector("#sender"),message=document.querySelector("#message"),preview=document.querySelector("#preview"),submit=document.querySelector("#submit-button");let kind="song";const deviceId=sessionStorage.getItem("selah-device-id")||crypto.randomUUID();sessionStorage.setItem("selah-device-id",deviceId);const safeId=()=>crypto.randomUUID();const copy=()=>({id:safeId(),title:title.value.trim(),kind,content:content.value,author:author.value,scriptureReferences:references.value,notes:notes.value,senderName:sender.value,deviceId});const show=(text,ok)=>{message.textContent=text;message.className="message show "+(ok?"success":"error")};const updatePreview=()=>{document.querySelector("#preview-title").textContent=title.value.trim();document.querySelector("#preview-content").textContent=content.value;preview.classList.add("show")};const presence=()=>fetch("/api/presence",{method:"POST",headers:{"content-type":"application/json","x-pairing-token":token},body:JSON.stringify({deviceId})}).catch(()=>{});presence();setInterval(presence,45000);document.querySelectorAll(".type").forEach(button=>button.addEventListener("click",()=>{kind=button.dataset.kind;document.querySelectorAll(".type").forEach(item=>item.setAttribute("aria-pressed",String(item===button)));const label=kind==="song"?"Lyrics":kind==="sermon"?"Sermon content or notes":"Announcement content";document.querySelector("#content-label").innerHTML=label+' <span aria-hidden="true">*</span>';document.querySelector("#content").placeholder=kind==="song"?"Keep line breaks and formatting as you write...":"Add the full message and preserve any details the studio should receive.";document.querySelector("#author-wrap").hidden=kind==="announcement";document.querySelector("#references-wrap").hidden=kind!=="sermon";document.querySelector("#author-label").textContent=kind==="sermon"?"Speaker / preacher":"Author / composer";preview.classList.remove("show");message.className="message"}));document.querySelector("#counter").textContent=content.value.length+" / 20,000";content.addEventListener("input",()=>document.querySelector("#counter").textContent=content.value.length+" / 20,000");document.querySelector("#preview-button").addEventListener("click",()=>{if(!title.value.trim()||!content.value.trim()){show("Add a title and content before previewing.",false);return}updatePreview()});form.addEventListener("submit",async event=>{event.preventDefault();if(!form.reportValidity())return;if(!token){show("This connection link is missing its access code. Ask the studio operator for a new QR code.",false);return}submit.disabled=true;submit.textContent="Sending securely…";message.className="message";try{const response=await fetch("/api/submissions",{method:"POST",headers:{"content-type":"application/json","x-pairing-token":token},body:JSON.stringify(copy())});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.message||result.error||"Could not submit. Check your connection and try again.");show("Received by Selah Studio. Thank you — the studio team will review it.",true);form.reset();content.value="";document.querySelector("#counter").textContent="0 / 20,000";preview.classList.remove("show")}catch(error){show(error instanceof Error?error.message:"Network error. Make sure both devices are on the same Wi-Fi network and try again.",false)}finally{submit.disabled=false;submit.innerHTML='Send to studio <span aria-hidden="true">→</span>'}});
})();
</script></body></html>"##;

async fn start_wifi_sharing(
    app: tauri::AppHandle,
    state: TauriState<'_, SharedState>,
) -> Result<WifiStatus, String> {
    {
        let mut data = state
            .lock()
            .map_err(|_| "The local sharing state is unavailable.".to_string())?;
        if data
            .session
            .as_ref()
            .is_some_and(|session| session.expires_at > now_seconds())
        {
            return Ok(status_for(&mut data));
        }
        stop_session(&mut data);
    }
    let address_ip = discover_private_ipv4()?;
    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(address_ip), 0))
        .await
        .map_err(|error| {
            format!("Could not start Wi-Fi sharing on {address_ip}: {error}. Check that the network is private and allow Selah Studio through Windows Firewall for private networks.")
        })?;
    let local_address = listener
        .local_addr()
        .map_err(|error| format!("Could not read the local sharing address: {error}"))?;
    let token = create_pairing_token();
    let expires_at = now_seconds() + SESSION_LIFETIME_SECONDS;
    let address = format!("http://{local_address}/connect?token={token}");
    let submissions_path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate Selah Studio local data: {error}"))?
        .join("incoming-submissions.json");
    let (stop_sender, mut stop_receiver) = oneshot::channel::<()>();
    let shared = state.inner().clone();
    {
        let mut data = state
            .lock()
            .map_err(|_| "The local sharing state is unavailable.".to_string())?;
        data.submissions = load_submissions(&submissions_path)?;
        data.session = Some(Session {
            address: address.clone(),
            token,
            expires_at,
            stop: Some(stop_sender),
        });
        data.devices.clear();
    }

    let server = submission_router(ServerState {
        shared: shared.clone(),
        app: Some(app.clone()),
        submissions_path,
    });

    tauri::async_runtime::spawn(async move {
        tokio::select! {
            result = axum::serve(listener, server) => {
                if let Err(error) = result {
                    eprintln!("Local Wi-Fi submission service stopped unexpectedly: {error}");
                    if let Ok(mut data) = shared.lock() {
                        stop_session(&mut data);
                    }
                    let _ = app.emit("wifi-service-error", error.to_string());
                }
            }
            _ = &mut stop_receiver => {}
        }
    });

    let mut data = state
        .lock()
        .map_err(|_| "The local sharing state is unavailable.".to_string())?;
    Ok(status_for(&mut data))
}

fn submission_router(state: ServerState) -> Router {
    Router::new()
        .route("/connect", get(page))
        .route("/api/presence", post(presence))
        .route("/api/submissions", post(submit))
        .layer(axum::extract::DefaultBodyLimit::max(32 * 1024))
        .with_state(state)
}

#[tauri::command]
fn get_wifi_status(state: TauriState<'_, SharedState>) -> Result<WifiStatus, String> {
    let mut data = state
        .lock()
        .map_err(|_| "The local sharing state is unavailable.".to_string())?;
    Ok(status_for(&mut data))
}

#[tauri::command]
fn stop_wifi_sharing(state: TauriState<'_, SharedState>) -> Result<WifiStatus, String> {
    let mut data = state
        .lock()
        .map_err(|_| "The local sharing state is unavailable.".to_string())?;
    stop_session(&mut data);
    Ok(status_for(&mut data))
}

#[tauri::command]
fn get_incoming_submissions(
    app: tauri::AppHandle,
    state: TauriState<'_, SharedState>,
) -> Result<Vec<IncomingSubmission>, String> {
    let path = incoming_path(&app)?;
    let mut data = state
        .lock()
        .map_err(|_| "The local inbox is unavailable.".to_string())?;
    if data.submissions.is_empty() {
        data.submissions = load_submissions(&path)?;
    }
    Ok(data.submissions.clone())
}

#[tauri::command]
fn update_incoming_submission(
    submission: IncomingSubmission,
    app: tauri::AppHandle,
    state: TauriState<'_, SharedState>,
) -> Result<Vec<IncomingSubmission>, String> {
    validate_studio_submission(&submission)?;
    let path = incoming_path(&app)?;
    let mut data = state
        .lock()
        .map_err(|_| "The local inbox is unavailable.".to_string())?;
    let Some(index) = data
        .submissions
        .iter()
        .position(|item| item.id == submission.id)
    else {
        return Err("This incoming submission no longer exists.".into());
    };
    data.submissions[index] = submission;
    persist_submissions(&path, &data.submissions)?;
    Ok(data.submissions.clone())
}

#[tauri::command]
fn delete_incoming_submission(
    id: String,
    app: tauri::AppHandle,
    state: TauriState<'_, SharedState>,
) -> Result<Vec<IncomingSubmission>, String> {
    let path = incoming_path(&app)?;
    let mut data = state
        .lock()
        .map_err(|_| "The local inbox is unavailable.".to_string())?;
    let original_len = data.submissions.len();
    data.submissions.retain(|submission| submission.id != id);
    if data.submissions.len() == original_len {
        return Err("This incoming submission no longer exists.".into());
    }
    persist_submissions(&path, &data.submissions)?;
    Ok(data.submissions.clone())
}

fn validate_studio_submission(submission: &IncomingSubmission) -> Result<(), String> {
    if !valid_identifier(&submission.id)
        || !valid_text(&submission.title, MAX_TITLE_LENGTH, false)
        || !valid_text(&submission.content, MAX_CONTENT_LENGTH, false)
        || !valid_text(&submission.author, 120, true)
        || !valid_text(&submission.scripture_references, 500, true)
        || !valid_text(&submission.notes, MAX_NOTES_LENGTH, true)
        || !valid_text(&submission.sender_name, 80, true)
        || !matches!(submission.status.as_str(), "pending" | "approved" | "rejected")
    {
        return Err("This submission contains invalid or oversized fields.".into());
    }
    Ok(())
}

fn incoming_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("incoming-submissions.json"))
        .map_err(|error| format!("Could not locate Selah Studio local data: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(ConnectData::default())))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            save_schedule,
            create_schedule,
            prepare_schedules_directory,
            start_wifi_sharing,
            get_wifi_status,
            stop_wifi_sharing,
            get_incoming_submissions,
            update_incoming_submission,
            delete_incoming_submission
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                if let Some(state) = window.try_state::<SharedState>() {
                    if let Ok(mut data) = state.lock() {
                        stop_session(&mut data);
                    }
                }
                if let Some(projector) = window.app_handle().get_webview_window("projector") {
                    let _ = projector.close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Selah Studio");
}

fn schedule_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|error| format!("Could not locate Documents: {error}"))?;
    let directory = documents.join("SelahStudio").join("Schedule");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the schedules folder: {error}"))?;
    Ok(directory)
}

#[tauri::command]
fn prepare_schedules_directory(app: tauri::AppHandle) -> Result<String, String> {
    schedule_directory(&app).map(|path| path.to_string_lossy().into_owned())
}

fn safe_schedule_name(name: &str) -> String {
    let sanitized: String = name
        .trim()
        .chars()
        .map(|character| {
            if matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '-'
            } else {
                character
            }
        })
        .collect();
    sanitized.trim().trim_end_matches('.').to_string()
}

#[tauri::command]
fn save_schedule(name: String, contents: String, app: tauri::AppHandle) -> Result<String, String> {
    let directory = schedule_directory(&app)?;
    let sanitized = safe_schedule_name(&name);
    let file_name = if sanitized.is_empty() { "Service Schedule" } else { &sanitized };
    let destination = directory.join(format!("{file_name}.selah"));
    fs::write(&destination, contents)
        .map_err(|error| format!("Could not write the schedule file: {error}"))?;

    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
fn create_schedule(name: String, contents: String, app: tauri::AppHandle) -> Result<String, String> {
    let directory = schedule_directory(&app)?;
    let sanitized = safe_schedule_name(&name);
    if sanitized.is_empty() {
        return Err("Enter a schedule name.".into());
    }
    let destination = directory.join(format!("{sanitized}.selah"));
    if destination.exists() {
        return Err("A schedule with that name already exists. Choose another name.".into());
    }
    fs::write(&destination, contents)
        .map_err(|error| format!("Could not write the schedule file: {error}"))?;

    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::{header::CONTENT_TYPE, Request};
    use tower::ServiceExt;

    #[test]
    fn private_interface_filter_excludes_public_and_loopback_addresses() {
        assert!(is_private_ipv4(Ipv4Addr::new(192, 168, 1, 4)));
        assert!(is_private_ipv4(Ipv4Addr::new(10, 4, 0, 3)));
        assert!(!is_private_ipv4(Ipv4Addr::new(8, 8, 8, 8)));
        assert!(!is_private_ipv4(Ipv4Addr::LOCALHOST));
        assert!(!is_private_ipv4(Ipv4Addr::new(169, 254, 1, 2)));
    }

    #[test]
    fn incoming_text_has_length_and_control_character_limits() {
        assert!(valid_text("A title\nwith lines", 30, false));
        assert!(!valid_text("", 30, false));
        assert!(!valid_text("x".repeat(MAX_TITLE_LENGTH + 1).as_str(), MAX_TITLE_LENGTH, false));
        assert!(!valid_text("text\u{0000}", 30, false));
    }

    #[test]
    fn pairing_tokens_are_compared_without_early_exit() {
        assert!(constant_time_equal("secret", "secret"));
        assert!(!constant_time_equal("secret", "secreu"));
        assert!(!constant_time_equal("secret", "short"));
    }

    #[test]
    fn incoming_submissions_round_trip_through_local_storage() {
        let path = std::env::temp_dir().join(format!(
            "selah-studio-inbox-test-{}-{}.json",
            std::process::id(),
            now_seconds()
        ));
        let submission = IncomingSubmission {
            id: "local-test-submission".to_string(),
            title: "Test song".to_string(),
            kind: SubmissionKind::Song,
            content: "First line\nSecond line".to_string(),
            author: "Test author".to_string(),
            scripture_references: String::new(),
            notes: "Keep the line breaks".to_string(),
            sender_name: "Test sender".to_string(),
            device_id: "local-test-device".to_string(),
            submitted_at: now_seconds(),
            status: "pending".to_string(),
        };
        persist_submissions(&path, std::slice::from_ref(&submission))
            .expect("submission should persist");
        let restored = load_submissions(&path).expect("submission should reload");
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].id, submission.id);
        assert_eq!(restored[0].content, submission.content);
        assert_eq!(restored[0].notes, submission.notes);
        fs::remove_file(&path).expect("test inbox should be removed");
    }

    #[tokio::test]
    async fn paired_http_workflow_persists_and_deduplicates_submission() {
        let path = std::env::temp_dir().join(format!(
            "selah-studio-http-test-{}-{}.json",
            std::process::id(),
            now_seconds()
        ));
        let token = "unit-test-pairing-secret";
        let shared = Arc::new(Mutex::new(ConnectData {
            session: Some(Session {
                address: "http://192.168.1.10:40123/connect".into(),
                token: token.into(),
                expires_at: now_seconds() + SESSION_LIFETIME_SECONDS,
                stop: None,
            }),
            ..ConnectData::default()
        }));
        let router = submission_router(ServerState {
            shared: shared.clone(),
            app: None,
            submissions_path: path.clone(),
        });

        let page_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/connect?token={token}"))
                    .body(Body::empty())
                    .expect("valid page request"),
            )
            .await
            .expect("page request should return");
        assert_eq!(page_response.status(), StatusCode::OK);

        let payload = serde_json::json!({
            "id": "unit-test-submission-0001",
            "title": "Local song",
            "kind": "song",
            "content": "First line\nSecond line",
            "author": "Local author",
            "scriptureReferences": "",
            "notes": "Preserve these lines",
            "senderName": "Guest",
            "deviceId": "unit-test-device-0001"
        });
        let request = || {
            Request::builder()
                .method("POST")
                .uri("/api/submissions")
                .header("x-pairing-token", token)
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(payload.to_string()))
                .expect("valid submission request")
        };
        let first = router
            .clone()
            .oneshot(request())
            .await
            .expect("submission should return");
        assert_eq!(first.status(), StatusCode::CREATED);

        let duplicate = router
            .clone()
            .oneshot(request())
            .await
            .expect("duplicate request should return");
        assert_eq!(duplicate.status(), StatusCode::OK);
        let restored = load_submissions(&path).expect("submission should be persisted");
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].content, "First line\nSecond line");

        if let Ok(mut data) = shared.lock() {
            stop_session(&mut data);
        }
        let revoked = router
            .oneshot(request())
            .await
            .expect("revoked request should return");
        assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);
        let _ = to_bytes(revoked.into_body(), 4096)
            .await
            .expect("error body should be readable");
        fs::remove_file(&path).expect("test inbox should be removed");
    }
}
