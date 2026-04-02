interface PermissionToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

export default function PermissionToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: PermissionToggleProps) {
  return (
    <label
      className={`flex items-center justify-between gap-4 py-2 font-mono text-sm ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <div className="min-w-0">
        <div className="text-text">{label}</div>
        {description && (
          <div className="text-gray-500 text-xs mt-0.5">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative shrink-0 w-10 h-5 rounded-full border transition-colors ${
          checked
            ? "bg-accent/20 border-accent"
            : "bg-gray-800 border-gray-700"
        } ${disabled ? "" : "hover:border-gray-600"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${
            checked ? "translate-x-5 bg-accent" : "translate-x-0 bg-gray-500"
          }`}
        />
      </button>
    </label>
  );
}
