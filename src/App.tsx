import { useEffect, useMemo, useState } from 'react';
import {
  Baby,
  BarChart3,
  Download,
  Droplets,
  Moon,
  Plus,
  Siren,
  Smile,
  TimerReset
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { db, isPoopWarning, type Cry, type Diaper, type Feeding, type Poop, type Sleep } from './db';
import { exportJson } from './export';
import { formatClock, formatDuration, startOfToday } from './time';

type Tab = 'quick' | 'timeline' | 'trends' | 'settings';
type TimelineItem = {
  id: string;
  ts: number;
  type: 'feeding' | 'diaper' | 'sleep-start' | 'sleep-end' | 'poop' | 'cry';
  title: string;
  detail: string;
  warning?: boolean;
};

const poopOptions = [
  { color: 'yellow', label: '黄' },
  { color: 'green', label: '绿' },
  { color: 'mustard', label: '芥末' },
  { color: 'brown', label: '褐' },
  { color: 'white', label: '白' },
  { color: 'gray', label: '灰白' },
  { color: 'clay', label: '陶土' },
  { color: 'red', label: '鲜红' },
  { color: 'black', label: '黑' }
] as const;

function App() {
  const [tab, setTab] = useState<Tab>('quick');
  const [feeding, setFeeding] = useState<Feeding[]>([]);
  const [diaper, setDiaper] = useState<Diaper[]>([]);
  const [sleep, setSleep] = useState<Sleep[]>([]);
  const [poop, setPoop] = useState<Poop[]>([]);
  const [cry, setCry] = useState<Cry[]>([]);
  const [selectedPoopColor, setSelectedPoopColor] = useState<Poop['color']>('yellow');
  const [status, setStatus] = useState('所有记录只保存在本机 IndexedDB。');

  async function refresh() {
    const today = startOfToday();
    const [feedingRows, diaperRows, sleepRows, poopRows, cryRows] = await Promise.all([
      db.feeding.where('ts').aboveOrEqual(today).reverse().sortBy('ts'),
      db.diaper.where('ts').aboveOrEqual(today).reverse().sortBy('ts'),
      db.sleep.where('startTs').aboveOrEqual(today).reverse().sortBy('startTs'),
      db.poop.where('ts').aboveOrEqual(today).reverse().sortBy('ts'),
      db.cry.where('ts').aboveOrEqual(today).reverse().sortBy('ts')
    ]);
    setFeeding(feedingRows.reverse());
    setDiaper(diaperRows.reverse());
    setSleep(sleepRows.reverse());
    setPoop(poopRows.reverse());
    setCry(cryRows.reverse());
  }

  useEffect(() => {
    void refresh();
  }, []);

  const activeSleep = useMemo(() => sleep.find((item) => !item.endTs), [sleep]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...feeding.map((item) => ({
        id: `feeding-${item.id}`,
        ts: item.ts,
        type: 'feeding' as const,
        title: '喂奶',
        detail: item.kind === 'formula' ? '配方奶' : item.kind === 'solid' ? '辅食' : '母乳'
      })),
      ...diaper.map((item) => ({
        id: `diaper-${item.id}`,
        ts: item.ts,
        type: 'diaper' as const,
        title: '尿布',
        detail: item.kind === 'pee' ? '尿' : item.kind === 'poop' ? '便' : '混合'
      })),
      ...sleep.flatMap((item) => [
        {
          id: `sleep-start-${item.id}`,
          ts: item.startTs,
          type: 'sleep-start' as const,
          title: '睡了',
          detail: item.endTs ? formatDuration(item.endTs - item.startTs) : '正在睡'
        },
        ...(item.endTs
          ? [
              {
                id: `sleep-end-${item.id}`,
                ts: item.endTs,
                type: 'sleep-end' as const,
                title: '醒了',
                detail: formatDuration(item.endTs - item.startTs)
              }
            ]
          : [])
      ]),
      ...poop.map((item) => ({
        id: `poop-${item.id}`,
        ts: item.ts,
        type: 'poop' as const,
        title: '大便颜色',
        detail: poopOptions.find((option) => option.color === item.color)?.label ?? item.color,
        warning: item.warningFlag
      })),
      ...cry.map((item) => ({
        id: `cry-${item.id}`,
        ts: item.ts,
        type: 'cry' as const,
        title: '哭闹',
        detail: item.intensity ? `强度 ${item.intensity}/5` : '待补标签'
      }))
    ];
    return items.sort((a, b) => b.ts - a.ts);
  }, [cry, diaper, feeding, poop, sleep]);

  const trendData = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour: `${hour}`, cry: 0, feed: 0 }));
    cry.forEach((item) => {
      buckets[new Date(item.ts).getHours()].cry += 1;
    });
    feeding.forEach((item) => {
      buckets[new Date(item.ts).getHours()].feed += 1;
    });
    return buckets.filter((bucket) => bucket.cry || bucket.feed);
  }, [cry, feeding]);

  async function record(action: 'feeding' | 'pee' | 'mixed-diaper' | 'sleep' | 'wake' | 'cry' | 'poop') {
    const now = Date.now();
    if (action === 'feeding') await db.feeding.add({ ts: now, kind: 'breast' });
    if (action === 'pee') await db.diaper.add({ ts: now, kind: 'pee' });
    if (action === 'mixed-diaper') await db.diaper.add({ ts: now, kind: 'mixed' });
    if (action === 'sleep') await db.sleep.add({ startTs: now });
    if (action === 'wake' && activeSleep?.id) await db.sleep.update(activeSleep.id, { endTs: now });
    if (action === 'cry') await db.cry.add({ ts: now, intensity: 3 });
    if (action === 'poop') {
      await db.poop.add({
        ts: now,
        color: selectedPoopColor,
        warningFlag: isPoopWarning(selectedPoopColor)
      });
      await db.diaper.add({ ts: now, kind: 'poop' });
    }
    setStatus(`${formatClock(now)} 已记录。`);
    await refresh();
  }

  const lastFeed = feeding[feeding.length - 1];
  const lastDiaper = diaper[diaper.length - 1];
  const sleepTotal = sleep.reduce((sum, item) => sum + ((item.endTs ?? Date.now()) - item.startTs), 0);

  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pb-28 pt-4 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-accent">BabyLog</p>
            <h1 className="mt-1 text-2xl font-semibold">今日快记</h1>
          </div>
          <button
            className="grid h-11 w-11 place-items-center rounded-lg border border-white/10 bg-panel text-muted"
            onClick={() => void exportJson()}
            title="导出 JSON"
          >
            <Download size={20} />
          </button>
        </header>

        <section className="grid gap-3 py-4 sm:grid-cols-3">
          <Metric label="距上次喂奶" value={lastFeed ? formatDuration(Date.now() - lastFeed.ts) : '无记录'} />
          <Metric label="距上次尿布" value={lastDiaper ? formatDuration(Date.now() - lastDiaper.ts) : '无记录'} />
          <Metric label="今日睡眠" value={sleepTotal ? formatDuration(sleepTotal) : '无记录'} />
        </section>

        {tab === 'quick' && (
          <section className="grid flex-1 content-start gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <QuickButton icon={<Baby />} label="喂奶" onClick={() => void record('feeding')} />
              <QuickButton icon={<Droplets />} label="尿布" onClick={() => void record('pee')} />
              <QuickButton
                icon={<Moon />}
                label={activeSleep ? '醒了' : '睡了'}
                onClick={() => void record(activeSleep ? 'wake' : 'sleep')}
                active={Boolean(activeSleep)}
              />
              <QuickButton icon={<Siren />} label="哭了" onClick={() => void record('cry')} />
              <QuickButton icon={<Smile />} label="混合尿布" onClick={() => void record('mixed-diaper')} />
              <QuickButton icon={<Plus />} label="大便颜色" onClick={() => void record('poop')} />
            </div>

            <div className="rounded-lg border border-white/10 bg-panel p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">大便颜色</h2>
                {isPoopWarning(selectedPoopColor) && (
                  <span className="rounded-md bg-accent px-2 py-1 text-xs font-semibold text-white">
                    建议尽快联系儿医
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-9">
                {poopOptions.map((option) => (
                  <button
                    key={option.color}
                    className={`min-h-11 rounded-lg border px-3 text-sm ${
                      selectedPoopColor === option.color
                        ? 'border-accent bg-accent text-white'
                        : 'border-white/10 bg-panel2 text-muted'
                    }`}
                    onClick={() => setSelectedPoopColor(option.color)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-sm text-muted">{status}</p>
          </section>
        )}

        {tab === 'timeline' && (
          <section className="grid gap-3 py-2">
            {timeline.length === 0 ? (
              <Empty label="今天还没有记录。" />
            ) : (
              timeline.map((item) => <TimelineRow key={item.id} item={item} />)
            )}
          </section>
        )}

        {tab === 'trends' && (
          <section className="grid gap-4 py-2">
            <div className="rounded-lg border border-white/10 bg-panel p-4">
              <h2 className="mb-4 text-sm font-semibold">按小时分布</h2>
              <div className="h-72">
                {trendData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trendData}>
                      <CartesianGrid stroke="#2B3040" vertical={false} />
                      <XAxis dataKey="hour" stroke="#98A2B3" />
                      <YAxis stroke="#98A2B3" allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: 'rgba(234, 88, 12, 0.12)' }}
                        contentStyle={{ background: '#171A22', border: '1px solid #2B3040', color: '#F8FAFC' }}
                      />
                      <Bar dataKey="feed" name="喂奶" fill="#38BDF8" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="cry" name="哭闹" fill="#EA580C" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty label="记录几条后这里会出现趋势。" />
                )}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-panel p-4 text-sm text-muted">
              6-8 周常见哭闹高峰的对照曲线会放在这里；MVP 先显示本机记录趋势。
            </div>
          </section>
        )}

        {tab === 'settings' && (
          <section className="grid gap-4 py-2">
            <div className="rounded-lg border border-white/10 bg-panel p-4">
              <h2 className="text-sm font-semibold">隐私与备份</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                当前版本不上传记录内容。JSON 导出不含二进制附件，完整 zip 导出预留在下一阶段。
              </p>
              <button
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white"
                onClick={() => void exportJson()}
              >
                <Download size={18} />
                导出 JSON
              </button>
            </div>
          </section>
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-bg/95 px-3 py-3 backdrop-blur">
        <div className="mx-auto grid max-w-2xl grid-cols-4 gap-2">
          <NavButton active={tab === 'quick'} icon={<Plus />} label="快记" onClick={() => setTab('quick')} />
          <NavButton
            active={tab === 'timeline'}
            icon={<TimerReset />}
            label="时间线"
            onClick={() => setTab('timeline')}
          />
          <NavButton
            active={tab === 'trends'}
            icon={<BarChart3 />}
            label="趋势"
            onClick={() => setTab('trends')}
          />
          <NavButton active={tab === 'settings'} icon={<Download />} label="备份" onClick={() => setTab('settings')} />
        </div>
      </nav>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-panel p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function QuickButton({
  icon,
  label,
  onClick,
  active = false
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      className={`flex min-h-28 flex-col items-start justify-between rounded-lg border p-4 text-left shadow-glow transition ${
        active ? 'border-accent bg-accent text-white' : 'border-white/10 bg-panel text-ink active:bg-panel2'
      }`}
      onClick={onClick}
    >
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-white/10">{icon}</span>
      <span className="text-xl font-semibold">{label}</span>
    </button>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <article className="grid grid-cols-[4.5rem_1fr] gap-3 rounded-lg border border-white/10 bg-panel p-3">
      <time className="text-sm text-muted">{formatClock(item.ts)}</time>
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{item.title}</h2>
          {item.warning && <span className="rounded-md bg-accent px-2 py-1 text-xs font-semibold">提醒</span>}
        </div>
        <p className="mt-1 text-sm text-muted">{item.detail}</p>
      </div>
    </article>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="grid min-h-32 place-items-center rounded-lg border border-dashed border-white/10 text-sm text-muted">{label}</div>;
}

function NavButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-14 flex-col items-center justify-center gap-1 rounded-lg text-xs ${
        active ? 'bg-accent text-white' : 'bg-panel text-muted'
      }`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default App;
