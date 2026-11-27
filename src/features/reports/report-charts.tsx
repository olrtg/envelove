import {
  Bar,
  ComposedChart,
  Line,
  ReferenceLine,
  Sector,
  Surface,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '#/components/ui/chart'
import { formatPlanMonth } from '#/features/plans/plan-month'
import type { PlanMonth } from '#/features/plans/plan-month'

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
  let angle = 90
  return (
    <div className="relative mx-auto aspect-square w-full max-w-72">
      <ChartContainer
        config={{}}
        className="aspect-square"
        aria-label="Share of spending"
        role="group"
      >
        {/* Render sectors directly so the first server response includes the ring. */}
        <Surface
          className="absolute inset-0"
          width="100%"
          height="100%"
          viewBox={{ x: 0, y: 0, width: 100, height: 100 }}
        >
          {items.map((item, i) => {
            const share = item.value / total
            const description = `${item.name}: ${(100 * share).toFixed(1)}%`
            const startAngle = angle
            angle -= share * 360
            return (
              <g
                key={item.id}
                role="button"
                tabIndex={0}
                aria-label={description}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(item.id)
                  }
                }}
                className="cursor-pointer hover:opacity-80"
                onClick={() => onSelect(item.id)}
              >
                <title>{description}</title>
                <Sector
                  cx={50}
                  cy={50}
                  innerRadius={36}
                  outerRadius={48}
                  startAngle={startAngle}
                  endAngle={angle}
                  fill={seriesColor(i)}
                />
              </g>
            )
          })}
        </Surface>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-[18%] flex flex-col items-center justify-center text-center">
        <span className="text-xs text-muted-foreground">Total spending</span>
        <strong className="max-w-full break-words font-heading text-2xl tabular-nums">
          {label}
        </strong>
      </div>
    </div>
  )
}

const balanceConfig = {
  assets: { label: 'Assets', color: seriesColor(0) },
  debts: { label: 'Debts', color: seriesColor(1) },
  net: { label: 'Net worth', color: 'var(--foreground)' },
}

export function BalanceChart({
  points,
  format,
}: {
  points: Array<{
    month: PlanMonth
    assets: number
    debts: number
    net: number
  }>
  format: (n: number) => string
}) {
  return (
    <ChartContainer
      config={balanceConfig}
      className="mt-4 aspect-[3/1] min-h-44 w-full"
    >
      <ComposedChart
        accessibilityLayer
        title="Monthly assets, debts, and net worth. See the table below for monthly balances."
        data={points.map((p) => ({
          ...p,
          month: formatPlanMonth(p.month),
          debts: -p.debts || 0,
        }))}
        stackOffset="sign"
        barCategoryGap="19%"
      >
        <XAxis dataKey="month" hide />
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <ChartLegend
          verticalAlign="top"
          content={<ChartLegendContent className="justify-start" />}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <>
                  <span className="text-muted-foreground">{name}</span>
                  <span className="ml-auto pl-3 font-mono tabular-nums">
                    {format(Number(value))}
                  </span>
                </>
              )}
            />
          }
        />
        <Bar
          dataKey="assets"
          name="Assets"
          stackId="balance"
          fill="var(--color-assets)"
          isAnimationActive={false}
        />
        <Bar
          dataKey="debts"
          name="Debts"
          stackId="balance"
          fill="var(--color-debts)"
          isAnimationActive={false}
        />
        <Line
          dataKey="net"
          name="Net worth"
          stroke="var(--color-net)"
          strokeWidth={2}
          dot={{ r: 2.5, fill: 'var(--color-net)' }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  )
}
