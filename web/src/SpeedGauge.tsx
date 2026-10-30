const TICKS = [0, 5, 10, 50, 100, 250, 500, 750, 1000];
const SWEEP_DEG = 240;
const RADIUS = 80;

// Each tick interval gets equal arc, so slow and fast links both move the needle visibly
export const gaugeFraction = (mbps: number) => {
  const next = TICKS.findIndex((tick) => mbps < tick);
  if (next === -1) return 1;
  if (next === 0) return 0;
  const low = TICKS[next - 1] ?? 0;
  const high = TICKS[next] ?? low;
  return (next - 1 + (mbps - low) / (high - low)) / (TICKS.length - 1);
};

const angleDeg = (fraction: number) => (fraction - 0.5) * SWEEP_DEG;

const point = (fraction: number, radius: number) => {
  const rad = (angleDeg(fraction) * Math.PI) / 180;
  return [100 + radius * Math.sin(rad), 100 - radius * Math.cos(rad)] as const;
};

const ARC = `M ${point(0, RADIUS).join(" ")} A ${RADIUS} ${RADIUS} 0 1 1 ${point(1, RADIUS).join(" ")}`;
const EASE = "0.4s ease-out";

type Props = { mbps: number; color: string; value: string; unit: string };

export const SpeedGauge = ({ mbps, color, value, unit }: Props) => {
  const fraction = gaugeFraction(mbps);

  return (
    <svg viewBox="0 0 200 180" role="img" aria-label={`${value} ${unit}`} style={{ width: "100%", maxWidth: 320 }}>
      <path d={ARC} fill="none" stroke="var(--mantine-color-default-border)" strokeWidth={12} strokeLinecap="round" />
      <path
        d={ARC}
        pathLength={1}
        fill="none"
        stroke={color}
        strokeWidth={12}
        strokeLinecap="round"
        strokeDasharray={`${fraction} 1`}
        style={{ transition: `stroke-dasharray ${EASE}, stroke ${EASE}` }}
      />
      {TICKS.map((tick, i) => {
        const [x, y] = point(i / (TICKS.length - 1), 62);
        return (
          <text key={tick} x={x} y={y} fontSize={8} textAnchor="middle" dominantBaseline="middle" fill="var(--mantine-color-dimmed)">
            {tick}
          </text>
        );
      })}
      <line
        x1={100}
        y1={100}
        x2={100}
        y2={52}
        stroke="var(--mantine-color-text)"
        strokeWidth={3}
        strokeLinecap="round"
        style={{ transformOrigin: "100px 100px", transform: `rotate(${angleDeg(fraction)}deg)`, transition: `transform ${EASE}` }}
      />
      <circle cx={100} cy={100} r={5} fill="var(--mantine-color-text)" />
      <text x={100} y={150} fontSize={26} fontWeight={700} textAnchor="middle" fill="var(--mantine-color-text)">
        {value}
      </text>
      <text x={100} y={168} fontSize={10} textAnchor="middle" fill="var(--mantine-color-dimmed)">
        {unit}
      </text>
    </svg>
  );
};
