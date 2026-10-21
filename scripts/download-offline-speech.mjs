import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelRoot = path.join(
  repoRoot,
  'artifacts',
  'selah-studio',
  'public',
  'models',
  'whisper-tiny.en',
);
const modelRepo = 'onnx-community/whisper-tiny.en';
const files = [
  'config.json',
  'generation_config.json',
  'merges.txt',
  'normalizer.json',
  'preprocessor_config.json',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'onnx/decoder_model_merged_quantized.onnx',
  'onnx/encoder_model_quantized.onnx',
];
const licenseFile = path.join(modelRoot, 'LICENSE');

await mkdir(modelRoot, { recursive: true });

for (const file of files) {
  const destination = path.join(modelRoot, file);
  try {
    const current = await stat(destination);
    if (current.size > 0) continue;
  } catch {
    // Download missing model assets.
  }

  const url = `https://huggingface.co/${modelRepo}/resolve/main/${file}?download=true`;
  console.log(`Downloading offline speech model file: ${file}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) {
    throw new Error(`Model download failed (${response.status}) for ${file}`);
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
}

try {
  const current = await stat(licenseFile);
  if (current.size === 0) throw new Error('Empty license file');
} catch {
  const response = await fetch('https://raw.githubusercontent.com/openai/whisper/main/LICENSE');
  if (!response.ok) throw new Error(`Whisper license download failed (${response.status})`);
  await writeFile(licenseFile, new Uint8Array(await response.arrayBuffer()));
}

console.log('Offline speech model assets are ready.');
