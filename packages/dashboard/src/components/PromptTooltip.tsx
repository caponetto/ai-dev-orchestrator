import { Check, Copy, FileText, XIcon } from 'lucide-react';
import { useState } from 'react';

import { linkify } from '../lib/linkify';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

export function PromptTrigger({
  onClick,
}: Readonly<{
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      className="inline-flex border-none bg-transparent p-0"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label="Show prompt"
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground hover:text-foreground" />
    </button>
  );
}

export function PromptDialog({
  prompt,
  open,
  onOpenChange,
}: Readonly<{
  prompt: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!prompt) {
      return;
    }
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Prompt</DialogTitle>
        </DialogHeader>
        <div className="absolute top-4 right-4 flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-xs p-0 opacity-70 transition-opacity hover:opacity-100"
            aria-label="Copy prompt"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
            }}
            className="rounded-xs p-0 opacity-70 transition-opacity hover:opacity-100"
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/80">
            {prompt ? linkify(prompt) : null}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
