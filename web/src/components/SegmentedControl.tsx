interface Props<T extends string> {
  options: ReadonlyArray<readonly [value: T, label: string]>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'md' | 'sm';
}

const SIZE = {
  md: 'px-3 py-1 text-xs',
  sm: 'px-2.5 py-1 text-[11px]',
};

/** Grupo de botones donde solo uno está activo: pestañas y filtros. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: Props<T>) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-lg bg-slate-900 p-0.5">
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`rounded-md font-medium transition-colors ${SIZE[size]} ${
            value === option ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
