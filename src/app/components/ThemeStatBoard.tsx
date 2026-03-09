'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { COLORSCHEME } from '../lib/simulation/types';
import { getTypeColors } from '../lib/simulation/typeColors';
import { PARTICLE_TYPES, ParticleType, semanticAttraction } from '../lib/simulation/attractionMatrix';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StatBoardEngine {
  onInjection: (() => void) | null;
  getTypeHistogram: () => Record<string, number>;
  getArticleCount: () => number;
}

type Histogram = Record<string, number>;
interface Props { engine: StatBoardEngine | null; colorScheme?: COLORSCHEME; }

// ── Taxonomy ───────────────────────────────────────────────────────────────────

const TAXONOMY = [
  {
    alignment: 'Good', color: '#7effd4', glowColor: 'rgba(126,255,212,0.35)', symbol: '✦',
    groups: [
      { label: 'Hope',       themes: ['Renewal', 'Aspiration', 'Resilience'] },
      { label: 'Love',       themes: ['Compassion', 'Unity', 'Devotion'] },
      { label: 'Generosity', themes: ['Abundance', 'Sacrifice', 'Sharing'] },
    ],
  },
  {
    alignment: 'Neutral', color: '#c8b8ff', glowColor: 'rgba(200,184,255,0.35)', symbol: '◈',
    groups: [
      { label: 'Balance', themes: ['Equilibrium', 'Moderation', 'Cyclical'] },
      { label: 'Change',  themes: ['Transformation', 'Adaptation', 'Flow'] },
      { label: 'Mystery', themes: ['Unknown', 'Potentia', 'Ambiguity'] },
    ],
  },
  {
    alignment: 'Evil', color: '#ff6b6b', glowColor: 'rgba(255,107,107,0.35)', symbol: '☠',
    groups: [
      { label: 'Decay',      themes: ['Entropy', 'Corruption', 'Erosion'] },
      { label: 'Domination', themes: ['Control', 'Subjugation', 'Tyranny'] },
      { label: 'Isolation',  themes: ['Separation', 'Void', 'Desolation'] },
    ],
  },
] as const;

// ── Derived module-level constants ─────────────────────────────────────────────

// theme name → its alignment color
const THEME_COLOR: Record<string, string> = {};
TAXONOMY.forEach(a => a.groups.forEach(g => g.themes.forEach(t => { THEME_COLOR[t] = a.color; })));

// row/col indices where alignment and group blocks start
const ALIGN_STARTS = new Set<number>();
const GROUP_STARTS = new Set<number>();
{
  let i = 0;
  TAXONOMY.forEach(a => {
    ALIGN_STARTS.add(i);
    a.groups.forEach(g => { GROUP_STARTS.add(i); i += g.themes.length; });
  });
}

// precomputed 27x27 semantic attraction values — static, no randomness
const MATRIX: number[][] = PARTICLE_TYPES.map(a =>
  PARTICLE_TYPES.map(b => semanticAttraction(a as ParticleType, b as ParticleType))
);

// ── Color helpers ──────────────────────────────────────────────────────────────

function cellColor(v: number): string {
  v = Math.max(-1, Math.min(1, v));
  if (Math.abs(v) < 0.001) return 'transparent';
  const alpha = 0.15 + Math.abs(v) * 0.85;
  return v > 0
    ? `rgba(${Math.round(26 * (1 - v))}, ${Math.round(255 * v)}, ${Math.round(80 * (1 - v))}, ${alpha})`
    : `rgba(${Math.round(255 * -v)}, ${Math.round(26 * (1 + v))}, ${Math.round(26 * (1 + v))}, ${alpha})`;
}

function cellGlow(v: number): string {
  const abs = Math.abs(v);
  if (abs < 0.1) return 'none';
  return v > 0
    ? `0 0 ${abs * 5}px rgba(0,255,85,${abs * 0.6})`
    : `0 0 ${abs * 5}px rgba(255,26,26,${abs * 0.6})`;
}

// ── Tooltip ────────────────────────────────────────────────────────────────────

const TIP_W = 168, TIP_H = 112, TIP_GAP = 8;
interface TipData { from: string; to: string; value: number; mouseX: number; mouseY: number; }

function Tooltip({ d }: { d: TipData }) {
  const v     = d.value;
  const label = v > 0.2 ? 'attracts' : v < -0.2 ? 'repels' : 'neutral';
  const lc    = v > 0.2 ? '#00ff55'  : v < -0.2 ? '#ff2020' : 'rgba(255,255,255,0.4)';
  const flipX = d.mouseX + TIP_GAP + TIP_W > window.innerWidth  - 4;
  const flipY = d.mouseY + TIP_GAP + TIP_H > window.innerHeight - 4;
  const left  = flipX ? d.mouseX - TIP_GAP - TIP_W : d.mouseX + TIP_GAP;
  const top   = flipY ? d.mouseY - TIP_GAP - TIP_H : d.mouseY + TIP_GAP;

  // Portalled into document.body — escapes any ancestor perspective/transform
  // that would corrupt position:fixed coordinates.
  return createPortal(
    <div style={{
      position: 'fixed', left, top, pointerEvents: 'none', zIndex: 99999,
      background: 'rgba(4,5,14,0.97)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 4, padding: '7px 10px', width: TIP_W,
      fontFamily: '"IBM Plex Mono","Fira Code",monospace', fontSize: '0.6rem',
      boxShadow: '0 4px 24px rgba(0,0,0,0.8)',
    }}>
      <div style={{ color: THEME_COLOR[d.from] || '#fff', marginBottom: 3 }}>{d.from}</div>
      <div style={{ color: 'rgba(255,255,255,0.3)', marginBottom: 3, letterSpacing: '0.1em' }}>
        → <span style={{ color: lc }}>{label}</span>
      </div>
      <div style={{ color: THEME_COLOR[d.to] || '#fff', marginBottom: 6 }}>{d.to}</div>
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 5,
        color: lc, fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.65rem',
      }}>
        {v > 0 ? '+' : ''}{v.toFixed(3)}
      </div>
    </div>,
    document.body
  );
}

// ── AnimatedNumber ─────────────────────────────────────────────────────────────

function AnimatedNumber({ value, color }: { value: number; color: string }) {
  const [display, setDisplay] = useState(0);
  const prev  = useRef(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const start = prev.current, end = value, t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - t0) / 900, 1);
      setDisplay(start + (end - start) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else prev.current = end;
    };
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [value]);

  return (
    <span style={{
      color, fontVariantNumeric: 'tabular-nums',
      textShadow: `0 0 8px ${color}`, fontSize: '0.72rem', letterSpacing: '0.04em',
    }}>
      {Math.round(display)}
    </span>
  );
}

// ── ScoreBar ───────────────────────────────────────────────────────────────────

function ScoreBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(value / max * 100, 100) : 0;
  return (
    <div style={{ width: 48, height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{
        width: `${pct}%`, height: '100%', background: color,
        boxShadow: `0 0 4px ${color}`, borderRadius: 2,
        transition: 'width 0.9s cubic-bezier(0.16,1,0.3,1)',
      }} />
    </div>
  );
}

// ── IndexView ──────────────────────────────────────────────────────────────────

function IndexView({ histogram, themeColor }: { histogram: Histogram; themeColor: Record<string, string> }) {
  const globalMax = Math.max(...Object.values(histogram), 1);

  return (
    <div style={{ display: 'flex' }}>
      {TAXONOMY.map((alignment, ai) => {
        const alignTotal = alignment.groups.flatMap(g => g.themes).reduce((s, t) => s + (histogram[t] || 0), 0);

        return (
          <div key={alignment.alignment} style={{
            flex: 1, padding: '16px 18px',
            borderRight: ai < TAXONOMY.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
          }}>

            {/* Alignment header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${alignment.color}22`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ color: alignment.color, fontSize: '0.8rem', textShadow: `0 0 10px ${alignment.color}` }}>
                  {alignment.symbol}
                </span>
                <span style={{
                  fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.18em',
                  color: alignment.color, textTransform: 'uppercase',
                  textShadow: `0 0 12px ${alignment.glowColor}`,
                }}>
                  {alignment.alignment}
                </span>
              </div>
              <AnimatedNumber value={alignTotal} color={alignment.color} />
            </div>

            {/* Groups */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {alignment.groups.map((group, gi) => {
                const isLastGroup = gi === alignment.groups.length - 1;
                const groupTotal  = group.themes.reduce((s, t) => s + (histogram[t] || 0), 0);

                return (
                  <div key={group.label}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.65rem', marginRight: 4, flexShrink: 0 }}>
                        {isLastGroup ? '└─' : '├─'}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.55)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                          {group.label}
                        </span>
                        <AnimatedNumber value={groupTotal} color={`${alignment.color}aa`} />
                      </span>
                    </div>

                    {group.themes.map((theme, ti) => {
                      const isLastTheme = ti === group.themes.length - 1;
                      const val = histogram[theme] || 0;
                      return (
                        <div key={theme} style={{
                          display: 'flex', alignItems: 'center',
                          paddingLeft: 10, marginBottom: isLastTheme ? 0 : 3,
                        }}>
                          <span style={{ color: 'rgba(255,255,255,0.12)', fontSize: '0.65rem', marginRight: 4, whiteSpace: 'pre', flexShrink: 0 }}>
                            {isLastGroup ? '   ' : '│  '}{isLastTheme ? '└─' : '├─'}
                          </span>
                          <span style={{
                            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                            background: themeColor[theme], boxShadow: `0 0 4px ${themeColor[theme]}`,
                            flexShrink: 0, marginRight: 5,
                          }} />
                          <span style={{
                            flex: 1, fontSize: '0.62rem', letterSpacing: '0.06em',
                            color: val > 0 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.22)',
                            transition: 'color 0.4s ease',
                          }}>
                            {theme}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            <ScoreBar value={val} max={globalMax} color={alignment.color} />
                            <AnimatedNumber value={val} color={val > 0 ? alignment.color : 'rgba(255,255,255,0.15)'} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── MatrixView ─────────────────────────────────────────────────────────────────

const CELL = 13, LABEL_W = 82;

// Left-border style shared by column headers and row cells.
function segmentBorder(i: number): string {
  if (ALIGN_STARTS.has(i)) return `1px solid ${THEME_COLOR[PARTICLE_TYPES[i]]}33`;
  if (GROUP_STARTS.has(i)) return '1px solid rgba(255,255,255,0.07)';
  return '1px solid rgba(255,255,255,0.025)';
}

function MatrixView() {
  const [tip,  setTip]  = useState<TipData | null>(null);
  const [hRow, setHRow] = useState<number | null>(null);
  const [hCol, setHCol] = useState<number | null>(null);

  const dim = (idx: number, hovered: number | null) =>
    hovered === null || hovered === idx ? 1 : 0.3;

  return (
    <div style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

      {/* Legend */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, width: '100%',
        fontSize: '0.55rem', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', textTransform: 'uppercase',
      }}>
        <span style={{ letterSpacing: '0.16em' }}>Attraction Matrix</span>
        <span style={{ color: 'rgba(255,255,255,0.12)' }}>·</span>
        <span>Row attracts Column</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 60, height: 6, borderRadius: 3,
            background: 'linear-gradient(to right, #ff1a1a, transparent, #00ff55)',
            boxShadow: '0 0 6px rgba(0,255,85,0.3)',
          }} />
          <span>−1 · 0 · +1</span>
        </div>
      </div>

      <div style={{ display: 'inline-flex', flexDirection: 'column' }}>

        {/* Column headers */}
        <div style={{ display: 'flex', paddingLeft: LABEL_W, marginBottom: 2 }}>
          {PARTICLE_TYPES.map((type, ci) => (
            <div key={type} style={{
              width: CELL, height: 70, flexShrink: 0,
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 3,
              borderLeft: segmentBorder(ci),
              opacity: dim(ci, hCol), transition: 'opacity 0.15s ease',
            }}>
              <span style={{
                writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                fontSize: '0.48rem', whiteSpace: 'nowrap', letterSpacing: '0.06em', lineHeight: `${CELL}px`,
                color: hCol === ci ? THEME_COLOR[type] : `${THEME_COLOR[type]}99`,
                textShadow: hCol === ci ? `0 0 8px ${THEME_COLOR[type]}` : 'none',
                transition: 'color 0.15s, text-shadow 0.15s',
              }}>
                {type}
              </span>
            </div>
          ))}
        </div>

        {/* Rows */}
        {PARTICLE_TYPES.map((rowType, ri) => (
          <div key={rowType} style={{
            display: 'flex', alignItems: 'center',
            borderTop: ALIGN_STARTS.has(ri)
              ? `1px solid ${THEME_COLOR[rowType]}33`
              : GROUP_STARTS.has(ri) ? '1px solid rgba(255,255,255,0.07)' : 'none',
            opacity: dim(ri, hRow), transition: 'opacity 0.15s ease',
          }}>

            {/* Row label */}
            <div style={{ width: LABEL_W, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6, gap: 4 }}>
              <span style={{
                fontSize: '0.48rem', whiteSpace: 'nowrap', letterSpacing: '0.06em',
                color: hRow === ri ? THEME_COLOR[rowType] : `${THEME_COLOR[rowType]}99`,
                textShadow: hRow === ri ? `0 0 8px ${THEME_COLOR[rowType]}` : 'none',
                transition: 'color 0.15s, text-shadow 0.15s',
              }}>
                {rowType}
              </span>
              <div style={{ width: 4, height: 4, borderRadius: '50%', flexShrink: 0, opacity: 0.7, background: THEME_COLOR[rowType] }} />
            </div>

            {/* Cells */}
            {PARTICLE_TYPES.map((colType, ci) => {
              const val         = MATRIX[ri][ci];
              const isIntersect = hRow === ri && hCol === ci;
              const isHighlight = hRow === ri || hCol === ci;
              return (
                <div
                  key={colType}
                  onMouseEnter={e => {
                    setHRow(ri); setHCol(ci);
                    setTip({ from: rowType, to: colType, value: val, mouseX: e.clientX, mouseY: e.clientY });
                  }}
                  onMouseMove={e => setTip(p => p ? { ...p, mouseX: e.clientX, mouseY: e.clientY } : null)}
                  onMouseLeave={() => { setHRow(null); setHCol(null); setTip(null); }}
                  style={{
                    width: CELL, height: CELL, flexShrink: 0, cursor: 'crosshair',
                    background:  cellColor(val),
                    boxShadow:   isIntersect ? cellGlow(val) : isHighlight ? cellGlow(val * 0.6) : 'none',
                    borderLeft:  segmentBorder(ci),
                    borderBottom: '1px solid rgba(255,255,255,0.025)',
                    outline:     isIntersect ? '1px solid rgba(255,255,255,0.3)' : 'none',
                    position: 'relative', zIndex: isIntersect ? 2 : 1,
                    transition: 'box-shadow 0.1s ease',
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Alignment labels */}
      <div style={{ display: 'flex', paddingLeft: LABEL_W, marginTop: 6 }}>
        {TAXONOMY.map(a => (
          <div key={a.alignment} style={{ width: CELL * 9, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: a.color, fontSize: '0.5rem' }}>{a.symbol}</span>
            <span style={{ fontSize: '0.48rem', color: `${a.color}99`, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              {a.alignment}
            </span>
          </div>
        ))}
      </div>

      {tip && <Tooltip d={tip} />}
    </div>
  );
}

// ── FlipButton ─────────────────────────────────────────────────────────────────

function FlipButton({ showMatrix, onClick }: { showMatrix: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
        background: hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${hovered ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 3, padding: '4px 9px', cursor: 'pointer', outline: 'none',
        fontFamily: '"IBM Plex Mono","Fira Code",monospace',
        fontSize: '0.55rem', letterSpacing: '0.14em', textTransform: 'uppercase',
        color: hovered ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)',
        transition: 'all 0.18s ease',
      }}
    >
      <svg width="11" height="9" viewBox="0 0 11 9" fill="none" style={{ opacity: hovered ? 0.85 : 0.45, flexShrink: 0 }}>
        <rect x="0" y="0" width="5" height="9" rx="1" fill="currentColor" opacity="0.5" />
        <rect x="6" y="0" width="5" height="9" rx="1" fill="currentColor" opacity={showMatrix ? '0.9' : '0.25'} />
      </svg>
      {showMatrix ? 'Index' : 'Matrix'}
    </button>
  );
}

// ── ThemeStatBoard ─────────────────────────────────────────────────────────────

export default function ThemeStatBoard({ engine, colorScheme }: Props) {
  const [histogram,    setHistogram]    = useState<Histogram>({});
  const [articleCount, setArticleCount] = useState(0);
  const [isAnimating,  setIsAnimating]  = useState(false);
  const [visibleFace,  setVisibleFace]  = useState(false); // false = index, true = matrix

  const themeColor = useMemo(() =>
    Object.fromEntries(
      TAXONOMY.flatMap(a => a.groups.flatMap(g => g.themes))
        .map((name, i) => [name, getTypeColors(colorScheme)[i]])
    ),
  [colorScheme]);

  useEffect(() => {
    if (!engine) return;
    const sync = () => {
      setHistogram(engine.getTypeHistogram());
      setArticleCount(engine.getArticleCount());
    };
    engine.onInjection = sync;
    return () => { if (engine.onInjection === sync) engine.onInjection = null; };
  }, [engine]);

  const flip = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setTimeout(() => setVisibleFace(v => !v), 200);  // swap content at midpoint of fold
    setTimeout(() => setIsAnimating(false), 420);
  };

  return (
    <>
      <style>{`
        @keyframes pulse   { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
        @keyframes face-in { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        .sb-body          { transition:transform 0.4s cubic-bezier(0.4,0,0.2,1),opacity 0.4s cubic-bezier(0.4,0,0.2,1); }
        .sb-body.flipping { transform:rotateX(90deg) scale(0.97); opacity:0; }
        .sb-face          { animation:face-in 0.22s ease forwards; }
      `}</style>

      <div style={{
        fontFamily: '"IBM Plex Mono","Fira Code","Courier New",monospace',
        background: 'rgba(4,5,12,0.92)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6, backdropFilter: 'blur(12px)',
        boxShadow: '0 0 40px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.04)',
        position: 'relative', overflow: 'hidden', width: '100%',
      }}>

        {/* Scanlines */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
          backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.15) 2px,rgba(0,0,0,0.15) 4px)',
        }} />

        {/* Header */}
        <div style={{
          position: 'relative', zIndex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
              Zeitgeist Engine
            </span>
            <span style={{ color: 'rgba(255,255,255,0.1)', fontSize: '0.6rem' }}>·</span>
            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.75)', letterSpacing: '0.08em', transition: 'color 0.3s' }}>
              {visibleFace ? 'Attraction Matrix' : 'Thematic Index'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em' }}>
              {articleCount > 0 ? `${articleCount} article${articleCount !== 1 ? 's' : ''} processed` : 'awaiting injection…'}
            </span>
            <div style={{
              width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
              background: articleCount > 0 ? '#7effd4' : 'rgba(255,255,255,0.15)',
              boxShadow: articleCount > 0 ? '0 0 8px #7effd4' : 'none',
              animation: articleCount > 0 ? 'pulse 2s ease-in-out infinite' : 'none',
            }} />
            <FlipButton showMatrix={visibleFace} onClick={flip} />
          </div>
        </div>

        {/* Body */}
        <div className={`sb-body${isAnimating ? ' flipping' : ''}`} style={{ position: 'relative', zIndex: 1 }}>
          <div className="sb-face" key={visibleFace ? 'matrix' : 'index'}>
            {visibleFace
              ? <MatrixView />
              : <IndexView histogram={histogram} themeColor={themeColor} />
            }
          </div>
        </div>
      </div>
    </>
  );
}
