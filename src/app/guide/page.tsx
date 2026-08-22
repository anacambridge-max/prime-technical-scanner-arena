import type { Metadata } from "next";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  GitBranch,
  Globe,
  KeyRound,
  Radio,
  ShieldCheck,
  TerminalSquare,
  TriangleAlert,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Setup Guide — Prime Technical Live Scanner",
};

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#1b2537] bg-[#0a101c]/70 p-5">
      <div className="flex items-center gap-3">
        <span className="mono flex h-7 w-7 items-center justify-center rounded-md border border-sky-400/30 bg-sky-400/10 text-[11px] font-bold text-sky-300">
          {n}
        </span>
        <h2 className="text-[14px] font-semibold tracking-wide text-slate-100">{title}</h2>
      </div>
      <div className="mt-3 space-y-2 text-[12.5px] leading-relaxed text-slate-400">{children}</div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="mono rounded border border-[#243148] bg-[#070d18] px-1.5 py-0.5 text-[11px] text-emerald-300">
      {children}
    </code>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 size={13} className="mt-[3px] shrink-0 text-emerald-300" />
      <span>{children}</span>
    </li>
  );
}

export default function GuidePage() {
  return (
    <div className="relative min-h-screen">
      <div className="grid-overlay pointer-events-none absolute inset-0" />
      <header className="sticky top-0 z-40 border-b border-[#16203a] bg-[#04070d]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1000px] items-center gap-4 px-4 py-3">
          <a
            href="/"
            className="flex items-center gap-1.5 rounded-md border border-[#243148] bg-[#0b1220] px-2.5 py-1.5 text-[10px] font-semibold tracking-widest text-slate-300 hover:border-sky-400/40 hover:text-sky-300"
          >
            <ArrowLeft size={12} />
            SCANNER
          </a>
          <div className="flex items-center gap-2">
            <BookOpen size={15} className="text-sky-300" />
            <h1 className="text-[13px] font-bold tracking-[0.14em] text-slate-100">
              DEPLOYMENT SETUP GUIDE
            </h1>
          </div>
          <span className="ml-auto rounded-md border border-fuchsia-400/30 bg-fuchsia-400/10 px-2 py-1 text-[9px] font-bold tracking-widest text-fuchsia-300">
            EASY HINDI + ENGLISH
          </span>
        </div>
      </header>

      <main className="relative mx-auto max-w-[1000px] space-y-4 px-4 py-6">
        {/* intro */}
        <div className="rounded-xl border border-[#1b2537] bg-[#0a101c]/70 p-5">
          <p className="text-[13px] leading-relaxed text-slate-300">
            Yeh guide aapko step-by-step batayegi ki is scanner ko{" "}
            <span className="font-semibold text-slate-100">GitHub + Vercel + Upstox API</span>{" "}
            ke saath kaise deploy karein — taaki aapko ek{" "}
            <span className="font-semibold text-emerald-300">permanent link</span> mil jaye jo
            har trading day automatically 09:15–10:00 IST live scan kare. Total time: ~15–20
            minute. Koi paid plan zaroori nahi.
          </p>
          <p className="mt-2 text-[11px] text-slate-500">
            English: Follow the 5 steps below to get a permanent Vercel URL for this scanner,
            powered by your own Upstox API token. Nothing here places trades.
          </p>
        </div>

        <Step n="1" title="Upstox API Token banana (Upstox Developer App)">
          <ul className="space-y-1.5">
            <Li>
              <span>
                <span className="text-slate-200">upstox.com/developer</span> par jayein → login
                karein → <span className="text-slate-200">"New App"</span> banayein. App ka naam
                kuch bhi rakh sakte hain (e.g. <Code>prime-scanner</Code>).
              </span>
            </Li>
            <Li>
              <span>
                Redirect URL mein daalein: <Code>https://127.0.0.1</Code> ya aapka Vercel domain —
                scanner ke liye sirf token chahiye, OAuth flow nahi.
              </span>
            </Li>
            <Li>
              <span>
                App banne ke baad <Code>API Key</Code> + <Code>API Secret</Code> milega. Fir{" "}
                <span className="text-slate-200">login/auth flow</span> ya Upstox ka token
                utility se daily <span className="text-slate-200">Access Token</span> generate
                karein (token roz subah valid hota hai, raat ko expire ho jata hai — yeh Upstox
                ka rule hai).
              </span>
            </Li>
            <Li>
              <span className="text-amber-200/90">
                Token kabhi bhi GitHub code mein ya browser mein mat daalna. Sirf Vercel
                environment variable mein jayega (Step 4).
              </span>
            </Li>
          </ul>
        </Step>

        <Step n="2" title="Project ko apne GitHub par push karna (New Repository)">
          <ul className="space-y-1.5">
            <Li>
              <span>
                <span className="text-slate-200">github.com</span> → <Code>New Repository</Code> →
                naam: <Code>prime-technical-scanner</Code> → Private rakhen (recommended) →
                Create.
              </span>
            </Li>
            <Li>
              <span>
                Is project ka folder download/unzip karein, fir terminal mein:
              </span>
            </Li>
          </ul>
          <div className="mono mt-2 space-y-1 rounded-lg border border-[#1b2537] bg-[#070d18] p-3 text-[11px] text-slate-300">
            <div>cd prime-technical-scanner</div>
            <div>git init</div>
            <div>git add .</div>
            <div>git commit -m "prime technical live scanner"</div>
            <div>git branch -M main</div>
            <div>git remote add origin https://github.com/YOURNAME/prime-technical-scanner.git</div>
            <div>git push -u origin main</div>
          </div>
          <p className="text-[11px] text-slate-500">
            <GitBranch size={11} className="mr-1 inline" />
            GitHub Desktop app se bhi drag-and-drop kar sakte hain — command line zaroori nahi.
          </p>
        </Step>

        <Step n="3" title="Vercel par import (permanent link mil jayega)">
          <ul className="space-y-1.5">
            <Li>
              <span>
                <span className="text-slate-200">vercel.com</span> → GitHub se sign up/login →{" "}
                <Code>Add New → Project</Code> → apni repository select karein →{" "}
                <span className="text-slate-200">Import</span>.
              </span>
            </Li>
            <Li>
              <span>
                Framework auto-detect hoga (<Code>Next.js</Code>). Direct{" "}
                <span className="text-slate-200">Deploy</span> dabayein — first build ~2 minute
                mein live ho jayegi.
              </span>
            </Li>
            <Li>
              <span>
                Deploy ke baad aapko permanent URL milega:{" "}
                <Code>https://prime-technical-scanner.vercel.app</Code> — yahi aapka permanent
                link hai. Browser/mobile kahin se bhi khul jayega.
              </span>
            </Li>
          </ul>
        </Step>

        <Step n="4" title="Environment Variables (Vercel → Settings → Environment Variables)">
          <div className="space-y-2">
            <div className="rounded-lg border border-[#1b2537] bg-[#070d18] p-3">
              <div className="flex items-center gap-2">
                <KeyRound size={12} className="text-emerald-300" />
                <span className="mono text-[11px] font-semibold text-emerald-300">
                  UPSTOX_ACCESS_TOKEN
                </span>
              </div>
              <p className="mt-1">
                Value = aapka Upstox access token.{" "}
                <span className="text-slate-300">
                  Yeh set hote hi scanner LIVE Upstox data par chalega.
                </span>{" "}
                Bina token ke scanner "SIMULATION MODE" mein demo data dikhata hai.
              </p>
            </div>
            <div className="rounded-lg border border-[#1b2537] bg-[#070d18] p-3">
              <div className="flex items-center gap-2">
                <KeyRound size={12} className="text-sky-300" />
                <span className="mono text-[11px] font-semibold text-sky-300">DATABASE_URL</span>
              </div>
              <p className="mt-1">
                Results poore din persist hote hain — iske liye Postgres chahiye. Vercel par:{" "}
                <Code>Storage → Create Database → Postgres</Code> (free) — yeh{" "}
                <Code>DATABASE_URL</Code> / <Code>POSTGRES_URL</Code> automatically set kar
                deta hai. Local file <Code>src/db/index.ts</Code> already{" "}
                <Code>DATABASE_URL</Code> use karti hai.
              </p>
            </div>
            <div className="rounded-lg border border-[#1b2537] bg-[#070d18] p-3">
              <div className="flex items-center gap-2">
                <KeyRound size={12} className="text-amber-300" />
                <span className="mono text-[11px] font-semibold text-amber-300">
                  Optional tuning
                </span>
              </div>
              <p className="mt-1">
                <Code>SCAN_END=10:00</Code>, <Code>BREAKOUT_VOL_MIN=1.5</Code>,{" "}
                <Code>RISK_REWARD=2</Code>, <Code>VOLUME_REF_CANDLES=20</Code>,{" "}
                <Code>RESCAN_SECONDS=45</Code> — default values already sahi hain.
              </p>
            </div>
            <p className="text-[11px] text-slate-500">
              Variables save karne ke baad <Code>Deployments → Redeploy</Code> karein, taaki
              naye values live ho jayein.
            </p>
          </div>
        </Step>

        <Step n="5" title="Daily routine — kya karna hai har subah">
          <ul className="space-y-1.5">
            <Li>
              <span>
                Upstox token roz expire hota hai → subah 8:45–9:10 ke beech naya token generate
                karke Vercel env var update karein → Redeploy (ya Vercel dashboard se env edit
                → auto redeploy).
              </span>
            </Li>
            <Li>
              <span>
                09:15–10:00 IST: dashboard khula rakhein — har ~45 second mein auto-refresh hoga.
                Jo stocks PDH/PDL breakout ke saath confirm honge woh{" "}
                <span className="text-emerald-300 font-semibold">CONFIRMED</span> section mein
                aayenge aur <span className="text-slate-200">poore din page par rahenge</span>{" "}
                (database mein persist).
              </span>
            </Li>
            <Li>
              <span>
                10:00 ke baad scan lock ho jata hai — din bhar ka final result wahi dikhta hai.
                Agla din fresh scan.
              </span>
            </Li>
          </ul>
        </Step>

        {/* how scanner works */}
        <div className="rounded-xl border border-[#1b2537] bg-[#0a101c]/70 p-5">
          <div className="flex items-center gap-2">
            <Radio size={14} className="text-sky-300" />
            <h2 className="text-[14px] font-semibold text-slate-100">
              Scanner kaise kaam karta hai (simple bhasha mein)
            </h2>
          </div>
          <div className="mt-3 grid gap-3 text-[12px] leading-relaxed text-slate-400 md:grid-cols-2">
            <div className="rounded-lg border border-[#1b2537] bg-[#070d18] p-3">
              <div className="mb-1 font-semibold text-emerald-300">BUY = PDH Breakout</div>
              Kal ka HIGH (PDH) aaj ka sabse important level hai. Jab koi completed 5-minute
              candle PDH ke upar CLOSE kare + us candle ka volume normal se zyada ho + price 20
              EMA ke upar ho + agle candle bhi PDH ke upar hold kare (follow-through) — tabhi
              CONFIRMED BUY. Warna sirf WATCH/SETUP.
            </div>
            <div className="rounded-lg border border-[#1b2537] bg-[#070d18] p-3">
              <div className="mb-1 font-semibold text-rose-300">SELL = PDL Breakdown</div>
              Kal ka LOW (PDL) ke neeche completed candle CLOSE + volume confirmation + 20 EMA
              ke neeche + follow-through — tabhi CONFIRMED SELL. Fail ho gaya breakout toh
              scanner kabhi confirm nahi karega.
            </div>
            <div className="rounded-lg border border-[#1b2537] bg-[#070d18] p-3">
              <div className="mb-1 font-semibold text-sky-300">Table mein kya dikhta hai</div>
              STOCK · LTP · CHANGE · VOLUME (2.4x jaise) · 20 EMA (BULLISH/BEARISH) · PDH · PDL ·
              LEVEL · DISTANCE · SETUP · STATUS · ENTRY/SL/TARGET (sirf CONFIRMED ke liye) ·
              REASON — exact wajah, generic nahi. Row par click karke full audit trail dekhen
              (kis candle ne break kiya, kitna volume tha, confirmation time).
            </div>
            <div className="rounded-lg border border-[#1b2537] bg-[#070d18] p-3">
              <div className="mb-1 font-semibold text-amber-300">False signal se bachav</div>
              Engine ke 9 validation checks har signal ke saath dikhte hain (TradingView se
              cross-check ke liye). Agar ek bhi mandatory check missing ho — CONFIRMED nahi
              milta. Kam par sahi signals &gt; zyada jhooth signals.
            </div>
          </div>
        </div>

        {/* caution */}
        <div className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/5 px-4 py-3">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-300" />
          <div className="text-[11.5px] leading-relaxed text-amber-200/90">
            <span className="font-semibold">Zaroori:</span> Yeh tool sirf scanning ke liye hai —
            koi trade/order nahi lagata. Entry/SL/Target sirf reference ke liye hain (1:2
            risk-reward default). Intraday trading high risk hai; apni research aur risk
            management ke saath hi use karein. <ShieldCheck size={11} className="inline" /> Aapka
            Upstox token server par hi rehta hai, browser ko kabhi nahi dikhta.
          </div>
        </div>

        <div className="flex items-center gap-2 pb-8 text-[10px] text-slate-600">
          <TerminalSquare size={12} />
          <span className="mono">
            repo: prime-technical-scanner · stack: Next.js 16 + TypeScript + PostgreSQL + Upstox
          </span>
          <Globe size={12} className="ml-auto" />
          <span className="mono">Asia/Kolkata · 09:15–10:00 IST</span>
        </div>
      </main>
    </div>
  );
}
