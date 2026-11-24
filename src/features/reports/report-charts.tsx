type Slice = { id: string; name: string; value: number }

export function seriesColor(index: number) {
  return `oklch(62% 0.14 ${(180 + index * 137.5) % 360})`
}

export function SpendingRing({
  items,
  label,
  onSelect,
}: {
  items: Array<Slice>
  label: string
  onSelect: (id: string) => void
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  let offset = 0
  return (
    <div className="relative mx-auto aspect-square w-full max-w-72">
      <svg
        viewBox="0 0 100 100"
        className="size-full -rotate-90"
        aria-label="Share of spending"
        role="group"
      >
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="12"
        />
        {items.map((item, i) => {
          const size = (item.value / total) * 100,
            start = offset
          offset += size
          return (
            <circle
              key={item.id}
              cx="50"
              cy="50"
              r="42"
              pathLength="100"
              fill="none"
              stroke={seriesColor(i)}
              strokeWidth="12"
              strokeDasharray={`${size} ${100 - size}`}
              strokeDashoffset={-start}
              role="button"
              tabIndex={0}
              aria-label={`${item.name}: ${size.toFixed(1)}%`}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(item.id)
                }
              }}
              className="cursor-pointer hover:opacity-80"
              onClick={() => onSelect(item.id)}
            >
              <title>
                {item.name}: {size.toFixed(1)}%
              </title>
            </circle>
          )
        })}
      </svg>
      <div className="pointer-events-none absolute inset-[18%] flex flex-col items-center justify-center text-center">
        <span className="text-xs text-muted-foreground">Total spending</span>
        <strong className="max-w-full break-words font-heading text-2xl tabular-nums">
          {label}
        </strong>
      </div>
    </div>
  )
}

export function BalanceChart({
  points,
  format,
}: {
  points: Array<{ month: string; assets: number; debts: number; net: number }>
  format: (n: number) => string
}) {
  const top = Math.max(1, ...points.map((p) => p.assets)),
    bottom = Math.max(0, ...points.map((p) => p.debts))
  const y = (n: number) => 12 + (152 * (top - n)) / (top + bottom)
  const step = 600 / Math.max(points.length, 1),
    x = (i: number) => (i + 0.5) * step
  return (
    <svg
      role="img"
      aria-label="Monthly assets, debts, and net worth. See the table below for monthly balances."
      viewBox="0 0 600 178"
      className="w-full"
    >
      <line x1="0" x2="600" y1={y(0)} y2={y(0)} stroke="var(--border)" />
      {points.map((p, i) => (
        <g key={p.month}>
          <title>{`${p.month}: ${format(p.assets)} assets, ${format(p.debts)} debts, ${format(p.net)} net worth`}</title>
          <rect
            x={x(i) - step * 0.31}
            width={step * 0.62}
            y={y(p.assets)}
            height={y(0) - y(p.assets)}
            fill={seriesColor(0)}
          />
          <rect
            x={x(i) - step * 0.31}
            width={step * 0.62}
            y={y(0)}
            height={y(-p.debts) - y(0)}
            fill={seriesColor(1)}
          />
        </g>
      ))}
      <polyline
        points={points.map((p, i) => `${x(i)},${y(p.net)}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      {points.map((p, i) => (
        <circle
          key={p.month}
          cx={x(i)}
          cy={y(p.net)}
          r="2.5"
          fill="currentColor"
        />
      ))}
    </svg>
  )
}
