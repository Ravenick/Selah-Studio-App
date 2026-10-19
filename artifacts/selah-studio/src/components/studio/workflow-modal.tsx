import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
const commands = [
  ['Space / V (hold)','Push to talk','Release to finish the simulated voice capture.'],
  ['← / →','Previous / next slide','Loads the corresponding preview; Auto-Push controls live output.'],
  ['Enter','Load into preview','On a verse range or slide card; broadcasts only with Auto-Push on.'],
  ['A','Toggle Auto-Push','Applies to the next loaded item, not the current live screen.'],
  ['⌘ K / Ctrl K','Focus song search','Opens Songs and focuses the search field.'],
  ['/','Focus scripture book','Opens Scriptures and selects the book input.'],
  ['Enter / Tab / → in book & chapter','Advance input focus','Book → chapter → verse range. Invalid entries remain selected.'],
  ['DISPLAY LIVE','Manual transmission','Required when Auto-Push is off.'],
];
export function WorkflowModal({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="workflow-modal"><DialogHeader><div className="builder-eyebrow"><Info size={14}/>OPERATOR WORKFLOW</div><DialogTitle>Shortcuts | Workflow</DialogTitle><DialogDescription>Keyboard commands are paused while editing text or while a modal is open.</DialogDescription></DialogHeader><div className="workflow-table-wrap"><table><thead><tr><th>Command</th><th>Action</th><th>Routing</th></tr></thead><tbody>{commands.map(([key,action,description]) => <tr key={key}><td><kbd>{key}</kbd></td><td>{action}</td><td>{description}</td></tr>)}</tbody></table></div></DialogContent></Dialog>;
}