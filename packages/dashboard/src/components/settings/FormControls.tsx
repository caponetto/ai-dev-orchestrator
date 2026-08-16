import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function HelpIcon({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="ml-1 inline-flex h-3.5 w-3.5 cursor-default items-center justify-center rounded-full border border-border text-[9px] font-medium leading-none text-muted-foreground hover:border-blue-500 hover:text-blue-400">
            ?
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-xs bg-card text-2xs leading-relaxed text-foreground/80 shadow-lg ring-1 ring-border"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface ToggleProps {
  label: string;
  tooltip?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Toggle({ label, tooltip, checked, onChange }: ToggleProps) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="inline-flex items-center text-xs text-muted-foreground">
        {label}
        {tooltip && <HelpIcon text={tooltip} />}
      </span>
      <Switch size="sm" checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

interface NumberInputProps {
  label: string;
  tooltip?: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

export function NumberInput({
  label,
  tooltip,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: NumberInputProps) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="inline-flex items-center text-xs text-muted-foreground">
        {label}
        {tooltip && <HelpIcon text={tooltip} />}
      </span>
      <Input
        type="number"
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? undefined : Number(raw));
        }}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        className="h-7 w-28 text-xs"
      />
    </label>
  );
}

interface SelectProps {
  label: string;
  tooltip?: string;
  value: string;
  options: readonly string[];
  labelMap?: Readonly<Record<string, string>>;
  onChange: (value: string) => void;
}

export function Select({ label, tooltip, value, options, labelMap, onChange }: SelectProps) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="inline-flex items-center text-xs text-muted-foreground">
        {label}
        {tooltip && <HelpIcon text={tooltip} />}
      </span>
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-blue-500"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {labelMap?.[opt] ?? opt}
          </option>
        ))}
      </select>
    </label>
  );
}

interface InlineSelectProps {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}

export function InlineSelect({ value, options, onChange }: InlineSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-blue-500"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

interface SectionCardProps {
  title: string;
  tooltip?: string;
  children: React.ReactNode;
}

export function SectionCard({ title, tooltip, children }: SectionCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 inline-flex items-center text-sm font-semibold text-foreground/80">
        {title}
        {tooltip && <HelpIcon text={tooltip} />}
      </h3>
      {children}
    </div>
  );
}
