import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Baby,
  BarChart3,
  Download,
  Droplets,
  Mic,
  Moon,
  Plus,
  Save,
  Siren,
  Smile,
  TimerReset
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  db,
  isPoopWarning,
  type Cry,
  type CryLabel,
  type CryResolvedBy,
  type Diaper,
  type Feeding,
  type Poop,
  type Sleep
} from './db';
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

const resolvedByOptions: Array<{ value: CryResolvedBy; label: string }> = [
  { value: 'feeding', label: '喂奶' },
  { value: 'burp', label: '拍嗝' },
  { value: 'diaper', label: '换尿布' },
  { value: 'sleep', label: '哄睡' },
  { value: 'hold', label: '抱起来' },
  { value: 'self', label: '自行平复' },
  { value: 'other', label: '其他' }
];

const labelOptions: Array<{ value: CryLabel; label: string }> = [
  { value: 'hungry', label: '饿' },
  { value: 'tired', label: '困' },
  { value: 'discomfort', label: '不适' },
  { value: 'gas', label: '胀气' },
  { value: 'hold', label: '要抱' },
  { value: 'unsure', label: '不确定' }
];

const pieColors = ['#EA580C', '#38BDF8', '#22C55E', '#FACC15', '#A78BFA', '#FB7185', '#94A3B8'];

function App() {
  const [tab, setTab] = useState<Tab>('quick');
  const [feeding, setFeeding] = useState<Feeding[]>([]);
  const [diaper, setDiaper] = useState<Diaper[]>([]);
  const [sleep, setSleep] = useState<Sleep[]>([]);
  const [poop, setPoop] = useState<Poop[]>([]);
  const [cry, setCry] = useState<Cry[]>([]);
  const [selectedPoopColor, setSelectedPoopColor] = useState<Poop['color']>('yellow');
  const [status, setStatus] = useState('所有记录只保存在本机 IndexedDB。');
  const [now, setNow] = useState(Date.now());
  const [resolvingCryId, setResolvingCryId] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(1);
  const [resolvedBy, setResolvedBy] = useState<CryResolvedBy>('feeding');
  const [cryLabel, setCryLabel] = useState<CryLabel>('unsure');
  const [cryNote, setCryNote] = useState('');
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'recorded'>('idle');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  async function refresh() {
    const today = startOfToday();
    const [feedingRows, diaperRows, sleepRows, poopRows, todayCryRows, activeCryRows] = await Promise.all([
      db.feeding.where('ts').aboveOrEqual(today).sortBy('ts'),
      db.diaper.where('ts').aboveOrEqual(today).sortBy('ts'),
      db.sleep.where('startTs').aboveOrEqual(today).sortBy('startTs'),
      db.poop.where('ts').aboveOrEqual(today).sortBy('ts'),
      db.cry.where('startTs').aboveOrEqual(today).sortBy('startTs'),
      db.cry.where('status').equals('crying').sortBy('startTs')
    ]);
    const cryRowsById = new Map<number, Cry>();
    [...todayCryRows, ...activeCryRows].forEach((item) => {
      if (item.id) cryRowsById.set(item.id, item);
    });
    setFeeding(feedingRows);
    setDiaper(diaperRows);
    setSleep(sleepRows);
    setPoop(poopRows);
    setCry([...cryRowsById.values()].sort((a, b) => a.startTs - b.startTs));
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const activeSleep = useMemo(() => sleep.find((item) => !item.endTs), [sleep]);
  const activeCries = useMemo(() => cry.filter((item) => item.status === 'crying'), [cry]);
  const resolvingCry = useMemo(
    () => cry.find((item) => item.id === resolvingCryId) ?? activeCries[0],
    [activeCries, cry, resolvingCryId]
  );

  useEffect(() => {
    if (!resolvingCry) return;
    setDurationMinutes(Math.max(1, Math.round(((resolvingCry.endTs ?? Date.now()) - resolvingCry.startTs) / 60000)));
    setResolvedBy(resolvingCry.resolvedBy ?? 'feeding');
    setCryLabel(resolvingCry.label ?? 'unsure');
    setCryNote(resolvingCry.note ?? '');
    setRecordedBlob(null);
    setRecordingState('idle');
  }, [resolvingCry]);

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
      ...cry.map((item) => {
        const duration = item.durationS ? formatDuration(item.durationS * 1000) : formatDuration((item.endTs ?? now) - item.startTs);
        const resolvedLabel = resolvedByOptions.find((option) => option.value === item.resolvedBy)?.label;
        return {
          id: `cry-${item.id}`,
          ts: item.startTs,
          type: 'cry' as const,
          title: item.status === 'crying' ? '哭闹中' : '哭闹',
          detail: item.status === 'crying' ? `已哭 ${duration}` : `${duration}${resolvedLabel ? ` · ${resolvedLabel}` : ''}`
        };
      })
    ];
    return items.sort((a, b) => b.ts - a.ts);
  }, [cry, diaper, feeding, now, poop, sleep]);

  const trendData = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour: `${hour}`, cry: 0, feed: 0 }));
    cry.forEach((item) => {
      buckets[new Date(item.startTs).getHours()].cry += 1;
    });
    feeding.forEach((item) => {
      buckets[new Date(item.ts).getHours()].feed += 1;
    });
    return buckets.filter((bucket) => bucket.cry || bucket.feed);
  }, [cry, feeding]);

  const resolvedByData = useMemo(() => {
    const counts = new Map<CryResolvedBy, number>();
    cry.forEach((item) => {
      if (item.status === 'resolved' && item.resolvedBy) {
        counts.set(item.resolvedBy, (counts.get(item.resolvedBy) ?? 0) + 1);
      }
    });
    return resolvedByOptions
      .map((option) => ({ name: option.label, value: counts.get(option.value) ?? 0 }))
      .filter((item) => item.value > 0);
  }, [cry]);

  async function record(action: 'feeding' | 'pee' | 'mixed-diaper' | 'sleep' | 'wake' | 'cry' | 'poop') {
    const timestamp = Date.now();
    if (action === 'feeding') await db.feeding.add({ ts: timestamp, kind: 'breast' });
    if (action === 'pee') await db.diaper.add({ ts: timestamp, kind: 'pee' });
    if (action === 'mixed-diaper') await db.diaper.add({ ts: timestamp, kind: 'mixed' });
    if (action === 'sleep') await db.sleep.add({ startTs: timestamp });
    if (action === 'wake' && activeSleep?.id) await db.sleep.update(activeSleep.id, { endTs: timestamp });
    if (action === 'cry') {
      if (activeCries.length > 0) {
        setResolvingCryId(activeCries[0].id ?? null);
        setStatus('已有一条正在哭闹，先补归因。');
      } else {
        const id = await db.cry.add({ startTs: timestamp, status: 'crying', label: 'unsure' });
        setResolvingCryId(id);
        setStatus(`${formatClock(timestamp)} 已开始记录哭闹。`);
      }
    }
    if (action === 'poop') {
      await db.poop.add({
        ts: timestamp,
        color: selectedPoopColor,
        warningFlag: isPoopWarning(selectedPoopColor)
      });
      await db.diaper.add({ ts: timestamp, kind: 'poop' });
    }
    if (action !== 'cry') setStatus(`${formatClock(timestamp)} 已记录。`);
    await refresh();
  }

  async function startAudioRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatus('当前浏览器不支持录音。');
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      stream.getTracks().forEach((track) => track.stop());
      setRecordedBlob(blob);
      setRecordingState('recorded');
    };
    recorder.start();
    setRecordingState('recording');
    window.setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, 10000);
  }

  async function resolveCry() {
    if (!resolvingCry?.id) return;
    const endTs = Date.now();
    const durationS = Math.max(0, Math.round(durationMinutes * 60));
    await db.cry.update(resolvingCry.id, {
      endTs,
      durationS,
      resolvedBy,
      label: cryLabel,
      note: cryNote.trim() || undefined,
      status: 'resolved'
    });
    if (recordedBlob) {
      await db.attachment.add({
        eventType: 'cry',
        eventId: resolvingCry.id,
        kind: 'audio',
        blob: recordedBlob,
        createdAt: Date.now()
      });
    }
    setResolvingCryId(null);
    setRecordedBlob(null);
    setRecordingState('idle');
    setStatus(`${formatClock(endTs)} 已完成哭闹归因。`);
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
            {activeCries.map((item) => (
              <button
                key={item.id}
                className="rounded-lg border border-accent bg-accent/15 p-4 text-left shadow-glow"
                onClick={() => setResolvingCryId(item.id ?? null)}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-lg font-semibold">正在哭...</span>
                  <span className="text-sm text-accent">{formatDuration(now - item.startTs)}</span>
                </div>
                <p className="mt-1 text-sm text-muted">点这里补上是什么让 TA 不哭的。</p>
              </button>
            ))}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <QuickButton icon={<Baby />} label="喂奶" onClick={() => void record('feeding')} />
              <QuickButton icon={<Droplets />} label="尿布" onClick={() => void record('pee')} />
              <QuickButton
                icon={<Moon />}
                label={activeSleep ? '醒了' : '睡了'}
                onClick={() => void record(activeSleep ? 'wake' : 'sleep')}
                active={Boolean(activeSleep)}
              />
              <QuickButton icon={<Siren />} label="哭了" onClick={() => void record('cry')} active={activeCries.length > 0} />
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
            <div className="rounded-lg border border-white/10 bg-panel p-4">
              <h2 className="mb-4 text-sm font-semibold">解决方式占比</h2>
              <div className="h-72">
                {resolvedByData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={resolvedByData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={96} paddingAngle={3}>
                        {resolvedByData.map((_, index) => (
                          <Cell key={index} fill={pieColors[index % pieColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#171A22', border: '1px solid #2B3040', color: '#F8FAFC' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty label="完成哭闹归因后这里会出现占比。" />
                )}
              </div>
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

      {resolvingCry && (
        <ResolveCryPanel
          cry={resolvingCry}
          now={now}
          durationMinutes={durationMinutes}
          setDurationMinutes={setDurationMinutes}
          resolvedBy={resolvedBy}
          setResolvedBy={setResolvedBy}
          cryLabel={cryLabel}
          setCryLabel={setCryLabel}
          cryNote={cryNote}
          setCryNote={setCryNote}
          recordingState={recordingState}
          recordedBlob={recordedBlob}
          startAudioRecording={() => void startAudioRecording()}
          onClose={() => setResolvingCryId(null)}
          onResolve={() => void resolveCry()}
        />
      )}

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

function ResolveCryPanel({
  cry,
  now,
  durationMinutes,
  setDurationMinutes,
  resolvedBy,
  setResolvedBy,
  cryLabel,
  setCryLabel,
  cryNote,
  setCryNote,
  recordingState,
  recordedBlob,
  startAudioRecording,
  onClose,
  onResolve
}: {
  cry: Cry;
  now: number;
  durationMinutes: number;
  setDurationMinutes: (value: number) => void;
  resolvedBy: CryResolvedBy;
  setResolvedBy: (value: CryResolvedBy) => void;
  cryLabel: CryLabel;
  setCryLabel: (value: CryLabel) => void;
  cryNote: string;
  setCryNote: (value: string) => void;
  recordingState: 'idle' | 'recording' | 'recorded';
  recordedBlob: Blob | null;
  startAudioRecording: () => void;
  onClose: () => void;
  onResolve: () => void;
}) {
  return (
    <div className="fixed inset-0 z-20 grid place-items-end bg-black/60 px-3 pb-3 sm:place-items-center">
      <section className="max-h-[calc(100vh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-lg border border-white/10 bg-panel p-4 shadow-glow">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">哭闹归因</h2>
            <p className="mt-1 text-sm text-muted">
              {formatClock(cry.startTs)} 开始，约 {formatDuration(now - cry.startTs)}
            </p>
          </div>
          <button className="rounded-lg border border-white/10 px-3 py-2 text-sm text-muted" onClick={onClose}>
            稍后
          </button>
        </div>

        <label className="mt-4 grid gap-2 text-sm">
          <span className="text-muted">哭了多久</span>
          <input
            className="h-11 rounded-lg border border-white/10 bg-panel2 px-3 text-ink outline-none focus:border-accent"
            min={0}
            type="number"
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(Number(event.target.value))}
          />
        </label>

        <div className="mt-4">
          <h3 className="mb-2 text-sm text-muted">是什么让 TA 不哭的？</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {resolvedByOptions.map((option) => (
              <SegmentButton
                key={option.value}
                active={resolvedBy === option.value}
                label={option.label}
                onClick={() => setResolvedBy(option.value)}
              />
            ))}
          </div>
        </div>

        <div className="mt-4">
          <h3 className="mb-2 text-sm text-muted">当时可能是？</h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {labelOptions.map((option) => (
              <SegmentButton
                key={option.value}
                active={cryLabel === option.value}
                label={option.label}
                onClick={() => setCryLabel(option.value)}
              />
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-panel2 px-4 text-sm font-semibold text-ink disabled:opacity-60"
            disabled={recordingState === 'recording'}
            onClick={startAudioRecording}
          >
            <Mic size={18} />
            {recordingState === 'recording' ? '录音中...' : recordedBlob ? '已录 10 秒' : '录 10 秒'}
          </button>
          <p className="text-xs text-muted">录音只保存在本机，关联到这条哭闹。</p>
        </div>

        <label className="mt-4 grid gap-2 text-sm">
          <span className="text-muted">备注</span>
          <input
            className="h-11 rounded-lg border border-white/10 bg-panel2 px-3 text-ink outline-none focus:border-accent"
            value={cryNote}
            onChange={(event) => setCryNote(event.target.value)}
            placeholder="可选"
          />
        </label>

        <button
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white"
          onClick={onResolve}
        >
          <Save size={18} />
          完成归因
        </button>
      </section>
    </div>
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

function SegmentButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`min-h-11 rounded-lg border px-3 text-sm ${
        active ? 'border-accent bg-accent text-white' : 'border-white/10 bg-panel2 text-muted'
      }`}
      onClick={onClick}
    >
      {label}
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
  return (
    <div className="grid min-h-32 place-items-center rounded-lg border border-dashed border-white/10 text-sm text-muted">
      {label}
    </div>
  );
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
