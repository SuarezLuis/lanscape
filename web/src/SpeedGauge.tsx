const SCALE_STEPS = [100, 250, 500, 1000, 2500, 5000, 10000];
const TICK_COUNT = 5;
const SWEEP_DEG = 240;
const RADIUS = 80;

// Fixed steps so the dial rescales rarely and its labels stay round
export const gaugeMax = (mbps: number) => SCALE_STEPS.find((step) => mbps <= step) ?? SCALE_STEPS.at(-1) ?? mbps;

const angleDeg = (fraction: number) => (fraction - 0.5) * SWEEP_DEG;

const point = (fraction: number, radius: number) => {
  const rad = (angleDeg(fraction) * Math.PI) / 180;
  return [100 + radius * Math.sin(rad), 100 - radius * Math.cos(rad)] as const;
};

const ARC = `M ${point(0, RADIUS).join(" ")} A ${RADIUS} ${RADIUS} 0 1 1 ${point(1, RADIUS).join(" ")}`;
const EASE = "0.4s ease-out";

type Props = { mbps: number; max: number; color: string; value: string; unit: string };

export const SpeedGauge = ({ mbps, max, color, value, unit }: Props) => {
  const fraction = Math.min(Math.max(mbps / max, 0), 1);
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => (max / TICK_COUNT) * i);

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
      {ticks.map((tick, i) => {
        const [x, y] = point(i / TICK_COUNT, 62);
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
