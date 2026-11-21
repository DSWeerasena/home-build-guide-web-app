import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, BrickWall, Building2, Calculator, Check, CheckCircle2, ChevronRight,
  Circle, ClipboardCheck, Download, FileText, Hammer, HardHat, Home,
  Languages, Layers3, Lightbulb, LogOut, Menu, Pencil, Plus,
  Ruler, Save, Trash2, Undo2, Upload, User, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { calculateStage, calculateFoundation, buildFoundationCalculation, foundationToInches, calculateBrickwork, computeBrickworkBreakdown, calculateColumns, calculateBeams, calculateLintels, calculateSlab, calculateCementConcretFloor, BRICKWORK_CATEGORIES, LINTEL_SIZES, CONCRETE_MIXES, convertToMeters, convertFromMeters, formatInUnit, UNIT_LABELS, convertResultValue, calculateReinforcement, validateReinforcement, BAR_GROUPS, LENGTH_UNITS, type ReinforcementCalculation, type ReinforcementInput, type MemberType, type MeasuredValue, type StirrupConvention, type LengthUnit, type QuantityResult, type BrickworkCalculation, type WallOpening, type OpeningType, openingAreaSquareMetres, totalOpeningAreaSquareMetres, type CementWorksCalculation, type UnitType, type FoundationCalculation, type FoundationPlanData, type FoundationUnit, type PlanSegment } from "./utils/calculators";
import { TOTAL_LABELS, defaultCalcName, duplicateById, makeId, padIndex, removeById, stampRecord, sumQuantities, sumReinforcement, toggleWorkStatus, upsertById } from "./utils/multiCalc";
import { CATEGORY_CONFIGS, cementSummaryRows, getCategoryConfig } from "./utils/cementCategories";
import SavedCalculationList, { TotalsPanel, WorkStatusBadge, actionButtonStyle, type SavedItem } from "./components/SavedCalculationList";
import CementCalculatorForm from "./components/CementCalculatorForm";
import StaircaseCalculator, { StaircaseSummary } from "./components/StaircaseCalculator";
import { LanguageProvider, translate, useLanguage, type Translate } from "./i18n";
import { formatCubicFeet, formatFeet, round3, type StaircaseCalculation } from "./utils/staircase";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { useCloudProject } from "./cloud/useCloudProject";
import { cloudEnabled } from "./lib/firebase";
import { authErrorKey } from "./lib/api";
import { flattenProject } from "./lib/cloudProject";
import { loadProject } from "./utils/loadProject";
import { completionBlocker, isRecordCompleted, normalizeCompletion, stageRecords } from "./utils/progress";
import { DEFAULT_VOLUME_UNIT, displayVolume, FOUNDATION_WASTAGE_PERCENT, VOLUME_UNITS, isVolumeUnit, type VolumeUnit } from "./utils/quantities";
import { AREA_UNITS, LENGTH_UNITS as ALL_LENGTH_UNITS, convertAreaToSquareMetres, convertToMetres as lengthToMetres, toLengthUnit, isAreaUnit } from "./utils/units";
import { ConfirmDialog } from "./components/SavedCalculationList";
import ThemeToggle from "./components/ThemeToggle";
import { ThemeProvider } from "./theme/ThemeProvider";

type Status = "completed" | "progress" | "not-started";
type Segment = PlanSegment;
type Project = {
  name: string;
  userName: string;
  completed: string[];
  checklists: Record<string, boolean[]>;
  calculations: Record<string, any>;
  foundationCalculations?: FoundationCalculation[];
  brickworkCalculations?: BrickworkCalculation[];
  cementWorksCalculations?: CementWorksCalculation[];
  reinforcementCalculations?: ReinforcementCalculation[];
  foundationPlan: { segments: Segment[]; totalLength: number };
};

function GridIcon(props: any) { return <Layers3 {...props} />; }

function getAllStageIds(stages: MainStage[]): string[] {
  const ids: string[] = [];
  stages.forEach(stage => {
    ids.push(stage.id);
    if (stage.children) {
      stage.children.forEach(child => ids.push(child.id));
    }
  });
  return ids;
}

function getStageById(id: string, stages: MainStage[]): MainStage | SubStage | null {
  for (const stage of stages) {
    if (stage.id === id) return stage;
    if (stage.children) {
      const child = stage.children.find(c => c.id === id);
      if (child) return child;
    }
  }
  return null;
}

function getMainStageForId(id: string, stages: MainStage[]): MainStage | null {
  for (const stage of stages) {
    if (stage.id === id) return stage;
    if (stage.children?.some(c => c.id === id)) return stage;
  }
  return null;
}

// Stages hold only stable ids; names come from t(id) and descriptions from t(`stageDesc.${id}`).
type MainStage = {
  id: string;
  icon: any;
  children?: SubStage[];
};

type SubStage = {
  id: string;
  icon: any;
};

const STAGES: MainStage[] = [
  { id: "foundation", icon: Layers3 },
  { id: "brickwork", icon: BrickWall },
  {
    id: "cement-works",
    icon: Building2,
    children: [
      { id: "columns-beams-lintel", icon: Ruler },
      { id: "plastering", icon: Layers3 },
      { id: "flooring", icon: GridIcon },
      { id: "slab", icon: Layers3 },
      { id: "stair-case", icon: Home },
    ]
  }
];
const INITIAL: Project = {
  name: "My First House", userName: "Nimal", completed: ["foundation"],
  checklists: { foundation: [true, true, true, true], brickwork: [true, true, false, false], "columns-beams-lintel": [false, false, false, false], plastering: [false, false, false, false], flooring: [false, false, false, false], slab: [false, false, false, false], "stair-case": [false, false, false, false] },
  calculations: {},
  foundationPlan: { segments: [], totalLength: 0 },
};

// Starting point for a cloud account before its project has loaded.
const EMPTY_CHECKLISTS: Record<string, boolean[]> = Object.fromEntries(getAllStageIds(STAGES).filter(id => id !== "cement-works").map(id => [id, [false, false, false, false]]));
const EMPTY_PROJECT: Project = { name: "", userName: "", completed: [], checklists: EMPTY_CHECKLISTS, calculations: {}, foundationPlan: { segments: [], totalLength: 0 } };

const AppContext = createContext<any>(null);
function AppProvider({ children }: { children: React.ReactNode }) {
  const { language, setLanguage, t, tl, tn, tv } = useLanguage();
  const auth = useAuth();
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }, []);

  // Local mode (no Firebase settings): the project lives in this browser only, exactly as before.
  const [localProject, setLocalProject] = useState<Project>(() => {
    if (cloudEnabled) return INITIAL;
    try {
      return loadProject(JSON.parse(localStorage.getItem("hbg-project") || "") || INITIAL);
    } catch { return loadProject(INITIAL); }
  });
  useEffect(() => {
    // In cloud mode the browser copy is left untouched; it is only read for the one-time import.
    if (cloudEnabled) return;
    // Uploaded plan previews can be large; a full quota must not crash the app.
    try { localStorage.setItem("hbg-project", JSON.stringify(localProject)); }
    catch { notify(t("msg.storageFull")); }
  }, [localProject]);

  // Cloud mode: the signed-in user's project, loaded from and saved to the API.
  const cloud = useCloudProject({
    user: cloudEnabled ? auth.user : null, language, setLanguage, notify, t,
    totalStages: getAllStageIds(STAGES).length, emptyChecklists: EMPTY_CHECKLISTS, emptyProject: EMPTY_PROJECT,
  });
  const project = (cloudEnabled ? cloud.project : localProject) as Project;
  // Every change passes through normalizeCompletion, so a deleted, unticked or ongoing record removes "Completed" immediately.
  const rawSetProject = (cloudEnabled ? cloud.setProject : setLocalProject) as (p: Project) => void;
  const setProject = (next: Project) => rawSetProject(normalizeCompletion(next));
  // Plan images: a data URL in local mode, or a short-lived signed URL from the API in cloud mode.
  const planUrl = (plan?: FoundationPlanData | null) => plan?.image || (plan?.planId ? cloud.planUrls[plan.planId] : undefined);

  return <AppContext.Provider value={{ language, setLanguage, project, setProject, notify, t, tl, tn, tv, auth, cloud, planUrl }}>
    {children}{toast && <div className="toast" role="status" aria-live="polite"><CheckCircle2 size={18} />{toast}</div>}
  </AppContext.Provider>;
}
const useApp = () => useContext(AppContext);

function Logo({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className="logo">
    <span className="logo-mark">
      <svg width="20" height="19" viewBox="0 0 20 19" fill="none" aria-hidden="true">
        <path d="M10 1.5L1.5 8.5H3.5V17H8V12H12V17H16.5V8.5H18.5L10 1.5Z" stroke="currentColor" strokeWidth="1.7" fill="currentColor" fillOpacity="0.18" strokeLinejoin="round" strokeLinecap="round"/>
        <line x1="3.5" y1="17" x2="16.5" y2="17" stroke="currentColor" strokeWidth="0.75" opacity="0.55"/>
      </svg>
    </span>
    {!compact && <span>House Build <b>Guide</b></span>}
  </Link>;
}

function LanguageToggle() {
  const { language, setLanguage, t } = useApp();
  // Both options are always visible so a user who cannot read the current language can still find their own.
  return <div className="quick-controls language-switch" role="group" aria-label={t("lang.label")}>
    <Languages size={18} aria-hidden="true" />
    {(["en", "si"] as const).map(code => <button key={code} type="button" className={`lang-option ${language === code ? "active" : ""}`} aria-pressed={language === code} onClick={() => setLanguage(code)} lang={code}>{code === "en" ? "EN" : "සිංහල"}</button>)}
  </div>;
}

// The name shown in the app: the account profile in cloud mode, the demo name in local mode.
const displayNameOf = (project: Project) => (cloudEnabled ? project.userName : localStorage.getItem("hbg-name") || project.userName) || "";

// Signs out (cloud mode) and returns to the landing page; signed-out state then blocks every protected page.
function useLogout() {
  const { auth } = useApp();
  const nav = useNavigate();
  return async () => {
    if (auth.status === "signedIn") await auth.logout();
    nav("/", { replace: true });
  };
}

// Landing-page sections reachable from the navbar and footer: [element id, label key].
const LANDING_SECTIONS = [["how", "how"], ["stages", "stages"], ["features", "features"], ["about", "about"]] as const;

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  // Move keyboard focus to the section too, without a second jump.
  el.focus({ preventScroll: true });
  return true;
}

// Goes to a landing-page section from any page; on the landing page itself it just scrolls (and updates the #hash).
function SectionLink({ id, onNavigate, className, children }: { id: string; onNavigate?: () => void; className?: string; children: React.ReactNode }) {
  const location = useLocation();
  const nav = useNavigate();
  return <Link to={{ pathname: "/", hash: `#${id}` }} className={className} onClick={e => {
    onNavigate?.();
    if (location.pathname !== "/") return;
    e.preventDefault();
    if (scrollToSection(id) && location.hash !== `#${id}`) nav({ hash: `#${id}` }, { replace: true });
  }}>{children}</Link>;
}

function Navbar({ app = false }: { app?: boolean }) {
  const { t, project, auth } = useApp(); const [open, setOpen] = useState(false);
  const logout = useLogout();
  const signedIn = auth.status === "signedIn";
  const links = app ? [["/dashboard", t("dashboard")], ["/progress", t("progress")], ["/report", t("report")]] : [];
  const sections = app ? [] : LANDING_SECTIONS.map(([id, key]) => [id, t(key)] as const);
  const initial = (displayNameOf(project) || "?").trim().charAt(0).toUpperCase();
  return <header className={`navbar ${app ? "app-nav" : ""}`}><div className="nav-inner">
    <Logo /><nav className="desktop-nav">{links.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}{sections.map(([id, label]) => <SectionLink key={id} id={id}>{label}</SectionLink>)}</nav>
    <div className="nav-actions"><LanguageToggle /><ThemeToggle />{app ? <Link to="/profile" className="avatar" aria-label={t("nav.profile")} title={t("nav.profile")}>{initial}</Link> : signedIn
      ? <Link to="/dashboard" className="btn btn-primary desktop-only">{t("dashboard")}<ArrowRight size={17} /></Link>
      : <><Link to="/login" className="text-btn desktop-only">{t("login")}</Link><Link to="/register" className="btn btn-primary desktop-only">{t("getStarted")}<ArrowRight size={17} /></Link></>
    }<button className="icon-btn mobile-only" onClick={() => setOpen(!open)} aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")} aria-expanded={open}>{open ? <X /> : <Menu />}</button></div>
  </div>{open && <nav className="mobile-menu" aria-label={t("nav.menu")}>
    {links.map(([to, label]) => <Link onClick={() => setOpen(false)} key={to} to={to}>{label}<ChevronRight size={17} /></Link>)}
    {sections.map(([id, label]) => <SectionLink key={id} id={id} onNavigate={() => setOpen(false)}>{label}<ChevronRight size={17} /></SectionLink>)}
    {!app && (signedIn
      ? <Link to="/dashboard">{t("dashboard")}<ChevronRight size={17} /></Link>
      : <><Link to="/login">{t("login")}<ChevronRight size={17} /></Link><Link to="/register">{t("getStarted")}<ChevronRight size={17} /></Link></>)}
    {app && <Link to="/profile" onClick={() => setOpen(false)}>{t("nav.profile")}<ChevronRight size={17} /></Link>}
    {app && <button type="button" className="mobile-menu-button" onClick={() => { setOpen(false); void logout(); }}>{signedIn ? t("nav.logout") : t("nav.exit")}<ChevronRight size={17} /></button>}
  </nav>}</header>;
}

function HeroArchIllustration() {
  const { t } = useApp();
  return (
    <div className="hero-visual">
      <div className="arch-hero-card">
        <svg viewBox="0 0 520 480" fill="none" xmlns="http://www.w3.org/2000/svg" className="arch-hero-svg" aria-label={t("hero.svgLabel")}>
          <defs>
            <pattern id="aGrid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M32 0H0V32" style={{stroke:"var(--border)",strokeWidth:.5}} fill="none"/>
            </pattern>
            <pattern id="aMajor" width="160" height="160" patternUnits="userSpaceOnUse">
              <rect width="160" height="160" fill="url(#aGrid)"/>
              <path d="M160 0H0V160" style={{stroke:"var(--border)",strokeWidth:.8}} fill="none"/>
            </pattern>
          </defs>
          <rect width="520" height="480" style={{fill:"var(--card)"}}/>
          <rect width="520" height="480" fill="url(#aMajor)"/>
          {/* Corner crop marks */}
          <path d="M36 16L16 16L16 36" className="ah-corner"/>
          <path d="M484 16L504 16L504 36" className="ah-corner"/>
          <path d="M36 464L16 464L16 444" className="ah-corner"/>
          <path d="M484 464L504 464L504 444" className="ah-corner"/>
          {/* Foundation */}
          <rect x="78" y="386" width="364" height="18" className="ah-foundation"/>
          {/* Ground line */}
          <line x1="40" y1="404" x2="480" y2="404" className="ah-ground"/>
          {/* Walls */}
          <rect x="100" y="215" width="320" height="171" className="ah-wall"/>
          {/* Roof */}
          <path d="M83 215L260 106L437 215" className="ah-roof"/>
          {/* Chimney */}
          <rect x="338" y="140" width="24" height="57" className="ah-chimney"/>
          {/* Left window */}
          <rect x="122" y="258" width="68" height="52" className="ah-window"/>
          <line x1="156" y1="258" x2="156" y2="310" className="ah-detail"/>
          <line x1="122" y1="284" x2="190" y2="284" className="ah-detail"/>
          {/* Right window */}
          <rect x="330" y="258" width="68" height="52" className="ah-window"/>
          <line x1="364" y1="258" x2="364" y2="310" className="ah-detail"/>
          <line x1="330" y1="284" x2="398" y2="284" className="ah-detail"/>
          {/* Door */}
          <rect x="226" y="316" width="68" height="70" className="ah-window"/>
          <circle cx="282" cy="354" r="3" style={{fill:"var(--green)",opacity:.4}}/>
          {/* Horizontal dimension */}
          <line x1="78" y1="438" x2="442" y2="438" className="ah-dim-line"/>
          <line x1="78" y1="431" x2="78" y2="445" className="ah-dim-tick"/>
          <line x1="442" y1="431" x2="442" y2="445" className="ah-dim-tick"/>
          <line x1="78" y1="404" x2="78" y2="438" className="ah-dim-ext"/>
          <line x1="442" y1="404" x2="442" y2="438" className="ah-dim-ext"/>
          {/* Vertical dimension */}
          <line x1="56" y1="215" x2="56" y2="386" className="ah-dim-line"/>
          <line x1="49" y1="215" x2="63" y2="215" className="ah-dim-tick"/>
          <line x1="49" y1="386" x2="63" y2="386" className="ah-dim-tick"/>
          <line x1="100" y1="215" x2="56" y2="215" className="ah-dim-ext"/>
          <line x1="100" y1="386" x2="56" y2="386" className="ah-dim-ext"/>
          {/* Dimension labels */}
          <text x="260" y="456" textAnchor="middle" style={{fill:"var(--muted)",fontSize:"10.5px",fontWeight:700,fontFamily: "Inter, 'Noto Sans Sinhala', sans-serif",opacity:.7}}>8.40 m</text>
          <text x="40" y="305" textAnchor="middle" style={{fill:"var(--muted)",fontSize:"10.5px",fontWeight:700,fontFamily: "Inter, 'Noto Sans Sinhala', sans-serif",opacity:.7}} transform="rotate(-90,40,305)">6.20 m</text>
          {/* Stage labels */}
          <text x="260" y="400" textAnchor="middle" style={{fill:"var(--green)",fontSize:"7px",fontWeight:800,fontFamily: "Inter, 'Noto Sans Sinhala', sans-serif",letterSpacing:"2px",opacity:.5}}>{t("hero.svgFoundation")}</text>
          <text x="260" y="250" textAnchor="middle" style={{fill:"var(--green)",fontSize:"7px",fontWeight:800,fontFamily: "Inter, 'Noto Sans Sinhala', sans-serif",letterSpacing:"2px",opacity:.38}}>{t("hero.svgStructure")}</text>
          <text x="260" y="166" textAnchor="middle" style={{fill:"var(--green)",fontSize:"7px",fontWeight:800,fontFamily: "Inter, 'Noto Sans Sinhala', sans-serif",letterSpacing:"2px",opacity:.38}}>{t("hero.svgRoof")}</text>
          {/* Title block */}
          <rect x="350" y="452" width="154" height="22" style={{fill:"none",stroke:"var(--border)",strokeWidth:.75,opacity:.8}}/>
          <text x="358" y="461" style={{fill:"var(--subtle)",fontSize:"6.5px",letterSpacing:".8px",fontFamily: "Inter, 'Noto Sans Sinhala', sans-serif",opacity:.65}}>HOUSE BUILD GUIDE</text>
          <text x="358" y="470" style={{fill:"var(--subtle)",fontSize:"7px",fontWeight:700,fontFamily: "Inter, 'Noto Sans Sinhala', sans-serif",opacity:.55}}>DWG-01  ·  SCALE 1:100</text>
        </svg>
      </div>
      <div className="float-card progress-float">
        <div className="mini-icon"><Home size={16} /></div>
        <div>
          <small>{t("hero.cardProgress")}</small>
          <strong>{t("hero.cardProgressValue", { percent: 27 })}</strong>
          <div className="mini-progress"><i /></div>
        </div>
      </div>
      <div className="float-card quantity-float">
        <Calculator size={18} />
        <div>
          <small>{t("hero.cardEstimate")}</small>
          <strong>36.50 m</strong>
        </div>
      </div>
    </div>
  );
}

function Landing() {
  const { t } = useApp();
  const { hash } = useLocation();
  // Arriving with /#section (from another page or a shared link) scrolls to that section once it has rendered.
  useEffect(() => {
    if (!hash) return;
    const frame = requestAnimationFrame(() => scrollToSection(decodeURIComponent(hash.slice(1))));
    return () => cancelAnimationFrame(frame);
  }, [hash]);
  return <div><Navbar /><main>
    <section className="hero" id="home"><div className="ambient a1" /><div className="ambient a2" /><div className="hero-grid container">
      <div className="hero-copy"><div className="eyebrow"><span />{t("hero.eyebrow")}</div>
        <h1>{t("hero.title1")}<br /><em>{t("hero.title2")}</em></h1>
        <p>{t("hero.text")}</p>
        <div className="hero-actions"><Link to="/register" className="btn btn-primary btn-lg">{t("hero.start")}<ArrowRight size={19} /></Link><a href="#stages" className="btn btn-secondary btn-lg">{t("hero.explore")}</a></div>
        <div className="trust-row">{["hero.trust1", "hero.trust2", "hero.trust3"].map(k => <span key={k}><Check size={14} />{t(k)}</span>)}</div>
      </div>
      <HeroArchIllustration />
    </div></section>
    <section className="section" id="how" tabIndex={-1}><div className="container"><SectionHeading eyebrow={t("how.eyebrow")} title={t("how.title")} text={t("how.text")} />
      <div className="steps-grid">{([[User, 1], [HardHat, 2], [Ruler, 3], [FileText, 4]] as const).map(([Icon, n], i) => <article className="step-card" key={n}><div className="step-top"><span className="step-icon"><Icon /></span><span className="step-number">0{i + 1}</span></div><h3>{t(`how.step${n}.title`)}</h3><p>{t(`how.step${n}.text`)}</p></article>)}</div>
    </div></section>
    <section className="section journey-section" id="stages" tabIndex={-1}><div className="container"><SectionHeading eyebrow={t("journey.eyebrow")} title={t("journey.title")} text={t("journey.text")} />
      <div className="journey-grid">{STAGES.map((stage, i) => <article className="journey-card" key={stage.id}><div className="journey-icon"><stage.icon /></div><span>{String(i + 1).padStart(2, "0")}</span><h3>{t(stage.id)}</h3>{stage.children ? <div className="journey-substages">{stage.children.map(child => <small key={child.id}>{t(child.id)}</small>)}</div> : <p>{t(`stageDesc.${stage.id}`)}</p>}</article>)}</div>
    </div></section>
    <section className="section" id="features" tabIndex={-1}><div className="container"><SectionHeading eyebrow={t("features.eyebrow")} title={t("features.title")} text={t("features.text")} />
      <div className="features-grid">{([[Calculator, 1], [Upload, 2], [ClipboardCheck, 3], [FileText, 4], [Languages, 5], [Save, 6]] as const).map(([Icon, n]) => <article className="feature-card" key={n}><span><Icon /></span><div><h3>{t(`features.f${n}.title`)}</h3><p>{t(`features.f${n}.text`)}</p></div></article>)}</div>
    </div></section>
    <AboutSection />
  </main><Footer /></div>;
}

function AboutSection() {
  const { t } = useApp();
  const stats: [string | number, string][] = [
    [getAllStageIds(STAGES).length, t("about.statStages")],
    [2, t("about.statLanguages")],
    [ALL_LENGTH_UNITS.length, t("about.statUnits")],
    ["PDF", t("about.statReports")],
  ];
  return <section className="section about-section" id="about" tabIndex={-1}><div className="container">
    <SectionHeading eyebrow={t("about.eyebrow")} title={t("about.title")} text={t("about.text")} />
    <div className="about-stats">{stats.map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
    <div className="features-grid">{([[Lightbulb, "why"], [Ruler, "method"], [HardHat, "note"]] as const).map(([Icon, key]) => <article className="feature-card" key={key}><span><Icon /></span><div><h3>{t(`about.${key}.title`)}</h3><p>{t(`about.${key}.text`)}</p></div></article>)}</div>
    <p className="about-project">{t("about.project")}</p>
  </div></section>;
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="section-heading"><span className="eyebrow"><span />{eyebrow}</span><h2>{title}</h2><p>{text}</p></div>;
}
function Footer() {
  const { t } = useApp();
  return <footer><div className="container footer-grid"><div><Logo /><p>{t("footer.tagline")}</p></div><div><strong>{t("footer.explore")}</strong>{LANDING_SECTIONS.map(([id, key]) => <SectionLink key={id} id={id}>{t(key)}</SectionLink>)}</div><div><strong>{t("footer.system")}</strong><span>{t("footer.languages")}</span></div></div><div className="container copyright">{t("footer.copyright")}</div></footer>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useApp();
  return <div className="auth-page"><div className="auth-visual"><Logo /><div className="auth-visual-copy"><span className="eyebrow light"><span />{t("auth.eyebrow")}</span><h1>{t("auth.visualTitle")}</h1><p>{t("auth.visualText")}</p></div><small>{t("auth.photoCredit")}</small></div>
    <div className="auth-panel"><div className="auth-theme"><ThemeToggle /></div><div className="auth-mobile-top"><Logo /><div className="nav-actions"><LanguageToggle /><ThemeToggle /></div></div>{children}</div></div>;
}

function FormError({ message }: { message: string }) {
  return message ? <div role="alert" style={{ padding: "10px 12px", background: "#8B3838", borderRadius: "8px", color: "#FFE5E5", fontSize: "13px", marginBottom: "12px" }}>{message}</div> : null;
}

function AuthPage({ register = false }: { register?: boolean }) {
  const { t, auth, language, setLanguage } = useApp();
  const nav = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/dashboard";
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", language, remember: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  if (auth.status === "signedIn") return <Navigate to={from} replace />;

  const validate = (): string | null => {
    if (register && !form.name.trim()) return "authErr.nameRequired";
    if (!EMAIL_PATTERN.test(form.email.trim())) return "authErr.invalidEmail";
    if (register && (form.password.length < 8 || !/\d/.test(form.password))) return "authErr.weakPassword";
    if (!register && !form.password) return "authErr.passwordRequired";
    if (register && form.password !== form.confirm) return "authErr.passwordMismatch";
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (auth.status === "local") {
      // Local mode keeps the original demo sign-in: nothing leaves this browser.
      if (form.name.trim()) localStorage.setItem("hbg-name", form.name.trim());
      nav(from);
      return;
    }
    const problem = validate();
    if (problem) { setError(t(problem)); return; }
    setBusy(true);
    try {
      if (register) {
        setLanguage(form.language);
        await auth.register({ name: form.name.trim(), email: form.email, password: form.password, language: form.language });
      } else {
        await auth.login(form.email, form.password, form.remember);
      }
      nav(from, { replace: true });
    } catch (err) {
      setError(t(authErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const input = (key: "name" | "email" | "password" | "confirm", labelKey: string, type: string, placeholder: string, autoComplete: string) =>
    <Field label={t(labelKey)} type={type} placeholder={placeholder} value={form[key]} autoComplete={autoComplete} required={auth.status !== "local" || key === "name"} disabled={busy}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ [key]: e.target.value } as Partial<typeof form>)} />;

  return <AuthLayout><form className="auth-card" onSubmit={submit} noValidate>
    <span className="auth-icon"><Home /></span><h2>{register ? t("auth.registerTitle") : t("auth.loginTitle")}</h2><p>{register ? t("auth.registerText") : t("auth.loginText")}</p>
    <FormError message={error} />
    {register && input("name", "auth.fullName", "text", t("auth.fullNamePh"), "name")}
    {input("email", "auth.email", "email", "you@example.com", "email")}
    {input("password", "auth.password", "password", t("auth.passwordPh"), register ? "new-password" : "current-password")}
    {register && <>
      {input("confirm", "auth.confirmPassword", "password", t("auth.confirmPasswordPh"), "new-password")}
      <small className="password-hint"><Check size={13} />{t("auth.passwordHint")}</small>
      <label className="field"><span>{t("auth.preferredLanguage")}</span>
        <select value={form.language} disabled={busy} onChange={e => set({ language: e.target.value as "en" | "si" })} style={{ minHeight: "44px", padding: "8px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)" }}>
          <option value="en">English</option><option value="si">සිංහල</option>
        </select></label>
    </>}
    {!register && <div className="form-meta"><label><input type="checkbox" checked={form.remember} onChange={e => set({ remember: e.target.checked })} /> {t("auth.remember")}</label><Link to="/forgot-password">{t("auth.forgot")}</Link></div>}
    <button className="btn btn-primary btn-lg full" type="submit" disabled={busy} aria-busy={busy}>{busy ? t(register ? "auth.creating" : "auth.signingIn") : register ? t("auth.createAccount") : t("login")}{!busy && <ArrowRight size={18} />}</button>
    <div className="auth-switch">{register ? t("auth.haveAccount") : t("auth.noAccount")} <Link to={register ? "/login" : "/register"} state={location.state}>{register ? t("login") : t("auth.createAccountLink")}</Link></div>
    <div className="local-note"><Save size={16} /><span><strong>{t("auth.protectedTitle")}</strong> {t(auth.status === "local" ? "auth.localNote" : "auth.cloudNote")}</span></div>
  </form></AuthLayout>;
}

function ForgotPasswordPage() {
  const { t, auth } = useApp();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "busy") return;
    setError("");
    if (auth.status === "local") { setError(t("auth.localOnly")); return; }
    if (!EMAIL_PATTERN.test(email.trim())) { setError(t("authErr.invalidEmail")); return; }
    setState("busy");
    try {
      await auth.resetPassword(email);
      setState("sent");
    } catch (err) {
      // The same message is shown whether or not the email has an account, so accounts cannot be discovered here.
      if ((err as { code?: string })?.code === "auth/user-not-found") { setState("sent"); return; }
      setError(t(authErrorKey(err)));
      setState("idle");
    }
  };
  return <AuthLayout><form className="auth-card" onSubmit={submit} noValidate>
    <span className="auth-icon"><Home /></span><h2>{t("auth.resetTitle")}</h2><p>{t("auth.resetText")}</p>
    <FormError message={error} />
    {state === "sent"
      ? <div className="success-box" role="status"><CheckCircle2 /><div><strong>{t("auth.resetSentTitle")}</strong><p>{t("auth.resetSent")}</p></div></div>
      : <>
        <Field label={t("auth.email")} type="email" placeholder="you@example.com" value={email} autoComplete="email" disabled={state === "busy"} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
        <button className="btn btn-primary btn-lg full" type="submit" disabled={state === "busy"} aria-busy={state === "busy"}>{state === "busy" ? t("auth.sending") : t("auth.sendReset")}</button>
      </>}
    <div className="auth-switch"><Link to="/login">{t("auth.backToLogin")}</Link></div>
  </form></AuthLayout>;
}
function Field(props: any) { return <label className="field"><span>{props.label}</span><input {...props} label={undefined} /></label>; }

function FullPageMessage({ title, text, children }: { title: string; text?: string; children?: React.ReactNode }) {
  return <div className="app-shell"><main className="section"><div className="container empty" role="status" aria-live="polite"><h3>{title}</h3>{text && <p>{text}</p>}{children}</div></main></div>;
}

// Protected pages: signed-out visitors go to /login and come back to the page they asked for after signing in.
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { t, auth, cloud } = useApp();
  const location = useLocation();
  const logout = useLogout();
  if (auth.status === "local") return <>{children}</>;
  if (auth.status === "loading") return <FullPageMessage title={t("loading.account")} />;
  if (auth.status === "signedOut") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (cloud.status === "error") return <FullPageMessage title={t("err.loadTitle")} text={t("err.loadText")}>
    <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
      <button className="btn btn-primary" onClick={cloud.retryLoad}>{t("common.retry")}</button>
      <button className="btn btn-secondary" onClick={() => void logout()}>{t("nav.logout")}</button>
    </div>
  </FullPageMessage>;
  if (cloud.status !== "ready") return <FullPageMessage title={t("loading.project")} />;
  return <>{children}{cloud.legacyOffer && <MigrationDialog />}</>;
}

// One-time offer to copy a project saved only in this browser into the signed-in account.
function MigrationDialog() {
  const { t, cloud } = useApp();
  const [failed, setFailed] = useState(false);
  const legacy = cloud.legacyOffer as Project;
  const count = flattenProject(legacy).length;
  const doImport = async () => { setFailed(false); setFailed(!(await cloud.importLegacy())); };
  return <div role="presentation" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "grid", placeItems: "center", padding: "16px", zIndex: 1000 }}>
    <div role="dialog" aria-modal="true" aria-labelledby="migrate-title" style={{ width: "100%", maxWidth: "460px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px" }}>
      <h3 id="migrate-title" style={{ margin: "0 0 8px", fontSize: "17px" }}>{t("migrate.title")}</h3>
      <p style={{ margin: "0 0 8px", color: "var(--muted)", fontSize: "14px" }}>{t("migrate.text")}</p>
      <p style={{ margin: "0 0 16px", fontSize: "14px" }}><strong>{legacy.name}</strong> · {t("common.calculationsCount", { count })}</p>
      {failed && <FormError message={t("migrate.failed")} />}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary" disabled={cloud.importing} onClick={cloud.dismissLegacy}>{t("migrate.startFresh")}</button>
        <button type="button" className="btn btn-primary" disabled={cloud.importing} aria-busy={cloud.importing} onClick={() => void doImport()}>{cloud.importing ? t("migrate.importing") : failed ? t("common.retry") : t("migrate.import")}</button>
      </div>
    </div>
  </div>;
}

function VerifyEmailBanner() {
  const { t, auth, notify } = useApp();
  const [busy, setBusy] = useState(false);
  if (auth.status !== "signedIn" || auth.emailVerified) return null;
  const act = async (fn: () => Promise<void>, doneKey: string) => {
    setBusy(true);
    try { await fn(); notify(t(doneKey)); } catch (err) { notify(t(authErrorKey(err))); } finally { setBusy(false); }
  };
  return <div className="assumption" role="status" style={{ marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
    <Lightbulb /><span style={{ flex: "1 1 220px" }}>{t("verify.text", { email: auth.user?.email ?? "" })}</span>
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void act(auth.resendVerification, "verify.sent")}>{t("verify.resend")}</button>
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void act(auth.refreshUser, "verify.checked")}>{t("verify.done")}</button>
  </div>;
}

function SaveStatus() {
  const { t, cloud, auth } = useApp();
  if (auth.status !== "signedIn" || cloud.saveState === "idle") return null;
  const label = cloud.saveState === "saving" ? t("sync.saving") : cloud.saveState === "saved" ? t("sync.saved") : t("sync.error");
  return <div role="status" aria-live="polite" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "8px", fontSize: "12px", color: cloud.saveState === "error" ? "#FCA5A5" : "var(--muted)", marginBottom: "8px", minHeight: "20px" }}>
    {cloud.saveState === "saved" && <Check size={13} />}{label}
    {cloud.saveState === "error" && <button type="button" className="text-btn" onClick={() => void cloud.retrySave()}>{t("common.retry")}</button>}
  </div>;
}

// Returns to the previous in-app page, or to the logical parent page when the user arrived directly (new tab, bookmark, refresh).
function BackButton({ fallback }: { fallback: string }) {
  const { t } = useApp();
  const nav = useNavigate();
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) nav(-1); else nav(fallback);
  };
  return <button type="button" className="back-link page-back" onClick={goBack} aria-label={t("back")}><ArrowLeft size={16} aria-hidden="true" /> {t("back")}</button>;
}

function AppShell({ children, back }: { children: React.ReactNode; back?: string }) {
  const { t, auth } = useApp();
  const logout = useLogout();
  return <div className="app-shell"><Navbar app /><div className="app-layout"><aside><Logo compact /><NavLink to="/dashboard"><Home />{t("dashboard")}</NavLink><NavLink to="/progress"><Circle />{t("progress")}</NavLink><NavLink to="/report"><FileText />{t("report")}</NavLink><NavLink to="/profile"><User />{t("nav.profile")}</NavLink><div className="aside-bottom"><button type="button" className="aside-button" onClick={() => void logout()}><LogOut />{auth.status === "signedIn" ? t("nav.logout") : t("nav.exit")}</button></div></aside><main className="app-main"><SaveStatus /><VerifyEmailBanner />{back && <BackButton fallback={back} />}{children}</main></div></div>;
}

function ProfilePage() {
  const { t, auth, cloud, project, setProject, language, setLanguage, notify } = useApp();
  const nav = useNavigate();
  const logout = useLogout();
  const cloudMode = auth.status === "signedIn";
  const [name, setName] = useState(cloudMode ? cloud.profile?.name ?? "" : localStorage.getItem("hbg-name") || project.userName);
  const [savingName, setSavingName] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const box = { padding: "10px", minHeight: "44px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)", width: "100%" } as const;

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) { notify(t("authErr.nameRequired")); return; }
    setSavingName(true);
    try {
      if (cloudMode) await cloud.updateName(trimmed);
      else { localStorage.setItem("hbg-name", trimmed); setProject({ ...project, userName: trimmed }); }
      notify(t("profile.saved"));
    } catch (err) {
      notify(t(authErrorKey(err)));
    } finally { setSavingName(false); }
  };

  const deleteAccount = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    setDeleteError("");
    try {
      await auth.deleteAccount(password);
      notify(t("profile.deleted"));
      nav("/", { replace: true });
    } catch (err) {
      setDeleteError(t(authErrorKey(err)));
    } finally { setDeleting(false); }
  };

  return <AppShell back="/dashboard">
    <div className="page-head"><div><span className="eyebrow"><span />{t("profile.eyebrow")}</span><h1>{t("profile.title")}</h1><p>{t("profile.text")}</p></div></div>
    <section className="report-paper" style={{ display: "grid", gap: "16px", maxWidth: "640px" }}>
      <label className="field"><span>{t("profile.name")}</span>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={80} autoComplete="name" style={{ ...box, flex: "1 1 200px", width: "auto" }} />
          <button type="button" className="btn btn-primary" disabled={savingName} aria-busy={savingName} onClick={() => void saveName()}>{savingName ? t("common.saving") : t("save")}</button>
        </div></label>
      {cloudMode && <label className="field"><span>{t("auth.email")}</span><input value={auth.user?.email ?? ""} readOnly style={box} /></label>}
      <label className="field"><span>{t("lang.label")}</span>
        <select value={language} onChange={e => setLanguage(e.target.value as "en" | "si")} style={box}><option value="en">English</option><option value="si">සිංහල</option></select></label>
      <div><small style={{ color: "var(--muted)" }}>{t("profile.project")}</small><div><strong>{project.name}</strong> · <Link to="/dashboard">{t("dashboard")}</Link></div></div>
      {!cloudMode && <div className="assumption"><Lightbulb /><span>{t("profile.localMode")}</span></div>}
      <div><button type="button" className="btn btn-secondary" onClick={() => void logout()}><LogOut size={17} />{cloudMode ? t("nav.logout") : t("nav.exit")}</button></div>
      {cloudMode && <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
        <h3 style={{ margin: "0 0 6px", color: "#FCA5A5" }}>{t("profile.deleteTitle")}</h3>
        <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: "13px" }}>{t("profile.deleteText")}</p>
        <FormError message={deleteError} />
        <label className="field"><span>{t("profile.confirmPassword")}</span><input type="password" value={password} autoComplete="current-password" disabled={deleting} onChange={e => setPassword(e.target.value)} style={box} /></label>
        <button type="button" className="btn btn-primary" style={{ marginTop: "10px", background: "#B91C1C" }} disabled={!password || deleting} aria-busy={deleting} onClick={() => setConfirmDelete(true)}>{deleting ? t("profile.deleting") : t("profile.deleteButton")}</button>
      </div>}
    </section>
    {confirmDelete && <ConfirmDialog title={t("profile.deleteConfirmTitle")} message={t("profile.deleteConfirmText")} confirmLabel={t("profile.deleteButton")} onCancel={() => setConfirmDelete(false)} onConfirm={() => void deleteAccount()} />}
  </AppShell>;
}

function Dashboard() {
  const { project, setProject, t, notify } = useApp(); const [editing, setEditing] = useState(false);
  const allStageIds = getAllStageIds(STAGES);
  const progress = Math.round((project.completed.length / allStageIds.length) * 100);
  const currentId = allStageIds.find(s => !project.completed.includes(s));
  const current = currentId ? getStageById(currentId, STAGES) : STAGES[0];
  return <AppShell><div className="page-head"><div><span className="eyebrow"><span />{t("dash.eyebrow")}</span><h1>{t("welcome")}, {displayNameOf(project)}</h1><p>{t("dash.text")}</p></div><Link to="/report" className="btn btn-secondary"><FileText size={18} />{t("dash.generateReport")}</Link></div>
    <section className="project-title"><div><span>{t("project")}</span>{editing ? <input autoFocus value={project.name} onChange={e => setProject({ ...project, name: e.target.value })} onBlur={() => { setEditing(false); notify(t("msg.projectUpdated")); }} /> : <h2>{project.name}</h2>}</div><button className="icon-btn" onClick={() => setEditing(true)} aria-label={t("dash.editProjectName")}><Pencil size={18} /></button></section>
    <section className="overview-card"><div className="overview-main"><span>{t("dash.overallProgress")}</span><div className="progress-number"><strong>{progress}%</strong><span>{t("dash.stagesCompleted", { done: project.completed.length, total: allStageIds.length })}</span></div><ProgressBar value={progress} /></div><div className="current-stage"><span>{t("dash.currentStage")}</span><div><span className="stage-mini">{current && "icon" in current ? <current.icon /> : null}</span><div><strong>{current ? t(current.id) : ""}</strong><small>{t("dash.suggestedNext")}</small></div></div>{current && <Link to={`/stage/${current.id}`} className="btn btn-primary">{t("continue")}<ArrowRight size={17} /></Link>}</div></section>
    <div className="section-title-row"><div><h2>{t("dash.journey")}</h2><p>{t("dash.journeyText")}</p></div><span>{t("dash.completeCount", { done: project.completed.length, total: allStageIds.length })}</span></div>
    <div className="stage-grid">{STAGES.map((stage, i) => {
      const isMainStage = !stage.children;
      let status: Status;
      let displayProgress: string;

      if (isMainStage) {
        status = project.completed.includes(stage.id) ? "completed" : stage.id === current?.id ? "progress" : "not-started";
        displayProgress = status === "completed" ? "100%" : status === "progress" ? "50%" : "0%";
      } else {
        const completed = stage.children!.filter(c => project.completed.includes(c.id)).length;
        const total = stage.children!.length;
        status = completed === total ? "completed" : completed > 0 ? "progress" : "not-started";
        displayProgress = Math.round((completed / total) * 100) + "%";
      }

      return <Link to={`/stage/${stage.id}`} className="stage-card" key={stage.id}><span className="stage-bg-num">{String(i + 1).padStart(2, "0")}</span><div className="stage-card-top"><span className="stage-number">{String(i + 1).padStart(2, "0")}</span><StatusBadge status={status} /></div><span className="large-stage-icon"><stage.icon /></span><h3>{t(stage.id)}</h3><p>{t(`stageDesc.${stage.id}`)}</p><div className="stage-card-foot"><span>{t("dash.percentComplete", { percent: displayProgress })}</span><ChevronRight /></div></Link>;
    })}</div></AppShell>;
}
function StatusBadge({ status }: { status: Status }) {
  const { t } = useApp();
  return <span className={`status ${status}`}>{status === "completed" ? <Check size={13} /> : status === "progress" ? <Circle size={11} fill="currentColor" /> : <Circle size={11} />}{t(`status.${status}`)}</span>;
}
function ProgressBar({ value }: { value: number }) { return <div className="progress-bar"><i style={{ width: `${value}%` }} /></div>; }

const CHECKLIST_KEYS = ["checklist.item1", "checklist.item2", "checklist.item3", "checklist.item4"];
function StagePage() {
  const { id = "foundation" } = useParams();
  const stage = getStageById(id, STAGES);
  const { project, setProject, notify, t } = useApp();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("edit") ? "calculator" : "overview");

  if (!stage) return <AppShell back="/dashboard"><div className="page-head"><h1>{t("stage.notFound")}</h1></div></AppShell>;

  // If this is the Cement Works main stage, show category selection
  if (id === "cement-works") {
    const mainStage = getMainStageForId(id, STAGES) as MainStage;
    return <AppShell back="/dashboard">
      <div className="breadcrumbs"><Link to="/dashboard">{t("dashboard")}</Link><ChevronRight />{t(mainStage.id)}</div>
      <div className="stage-hero"><div className="stage-hero-icon">{mainStage?.icon ? <mainStage.icon /> : null}</div><div><span>{t("stage.number", { n: "03" })}</span><h1>{t(mainStage.id)}</h1><p>{t(`stageDesc.${mainStage.id}`)}</p></div></div>
      <CementWorksCalculator />
    </AppShell>;
  }

  // For other stages
  const mainStage = getMainStageForId(id, STAGES) as MainStage;
  const isSubStage = mainStage?.children?.some(c => c.id === id);
  const completed = project.completed.includes(id);
  const tabs = [["overview", Lightbulb, "tab.overview"], ["guide", HardHat, "tab.guide"], ["calculator", Calculator, "tab.calculator"], ["checklist", ClipboardCheck, "tab.checklist"]];
  // Completion is re-checked against the current records (setProject normalizes), so it can never be stale.
  const markComplete = () => {
    if (completed) return;
    const blocker = completionBlocker(project, id);
    if (blocker) { notify(t(`check.blocked.${blocker}`)); return; }
    setProject({ ...project, completed: [...project.completed, id] });
    notify(t("msg.stageCompleted", { stage: t(stage.id) }));
  };
  const markOngoing = () => {
    setProject({ ...project, completed: project.completed.filter((s: string) => s !== id) });
    notify(t("msg.stageReopened", { stage: t(stage.id) }));
  };

  const stageIndex = isSubStage ? STAGES.findIndex(s => s.id === "cement-works") : STAGES.findIndex(s => s.id === id);
  const stageNum = stageIndex >= 0 ? stageIndex + 1 : 1;

  return <AppShell back={isSubStage ? `/stage/${mainStage.id}` : "/dashboard"}>
    <div className="breadcrumbs">
      <Link to="/dashboard">{t("dashboard")}</Link><ChevronRight />
      {isSubStage && <><Link to={`/stage/${mainStage.id}`}>{t(mainStage.id)}</Link><ChevronRight /></>}
      {t(stage.id)}
    </div>
    <div className="stage-hero"><div className="stage-hero-icon">{"icon" in stage ? <stage.icon /> : null}</div><div><span>{t("stage.number", { n: String(stageNum).padStart(2, "0") })}</span><h1>{t(stage.id)}</h1><p>{t(`stageDesc.${stage.id}`)}</p></div><StatusBadge status={completed ? "completed" : "progress"} /></div>
    <div className="tabs">{tabs.map(([key, Icon, label]: any) => <button key={key} onClick={() => setTab(key)} className={tab === key ? "active" : ""}><Icon />{t(label)}</button>)}</div>
    <div className="tab-content">{tab === "overview" && <Overview stage={stage} onNext={() => setTab("guide")} />}{tab === "guide" && <Guide stage={stage} onNext={() => setTab("calculator")} />}{tab === "calculator" && (id === "foundation" ? <FoundationCalculator /> : id === "brickwork" ? <BrickworkCalculator /> : id === "columns-beams-lintel" ? <CementWorksCalculator only={["column", "beam", "lintel"]} /> : SUB_STAGE_CATEGORY[id] ? <CementWorksCalculator only={[SUB_STAGE_CATEGORY[id]]} /> : <ComingSoon stage={stage} />)}{tab === "checklist" && <Checklist stage={stage} onComplete={markComplete} onReopen={markOngoing} />}</div>
  </AppShell>;
}
function Overview({ stage, onNext }: any) {
  const { t } = useApp();
  const name = t(stage.id);
  return <div className="content-wrap"><div className="intro-card"><div><span className="info-icon"><stage.icon /></span><div><span>{t("overview.eyebrow")}</span><h2>{t("overview.title", { stage: name })}</h2><p>{t(`stageDesc.${stage.id}`)} {t("overview.text")}</p></div></div></div>
    <div className="info-grid"><InfoCard icon={Lightbulb} title={t("overview.whyTitle")} text={t("overview.whyText")} /><InfoCard icon={Hammer} title={t("overview.materialsTitle")} text={stage.id === "foundation" ? t("overview.materialsFoundation") : t("overview.materialsOther")} /><InfoCard icon={ClipboardCheck} title={t("overview.beforeTitle")} text={t("overview.beforeText")} /><InfoCard important icon={Ruler} title={t("overview.importantTitle")} text={t("overview.importantText")} /></div>
    <div className="tip-card"><Lightbulb /><div><strong>{t("overview.tipTitle")}</strong><p>{t("overview.tipText")}</p></div></div><div className="content-actions"><span /><button className="btn btn-primary" onClick={onNext}>{t("overview.startGuide")}<ArrowRight size={17} /></button></div></div>;
}
function InfoCard({ icon: Icon, title, text, important }: any) { return <article className={`info-card ${important ? "important" : ""}`}><span><Icon /></span><h3>{title}</h3><p>{text}</p></article>; }
function Guide({ stage, onNext }: any) {
  const { t } = useApp();
  const steps = [1, 2, 3, 4, 5].map(n => t(`guide.step${n}`, { stage: t(stage.id) }));
  return <div className="content-wrap narrow"><div className="content-heading"><span className="eyebrow"><span />{t("guide.eyebrow")}</span><h2>{t("guide.title")}</h2><p>{t("guide.text")}</p></div><div className="guide-list">{steps.map((text, i) => <div className="guide-step" key={i}><div className="step-line"><span>{i + 1}</span>{i < steps.length - 1 && <i />}</div><article><small>{t("guide.stepLabel", { n: i + 1 })}</small><h3>{text}</h3><p>{i === 0 ? t("guide.firstNote") : t("guide.otherNote")}</p></article></div>)}</div><div className="content-actions"><span /><button className="btn btn-primary" onClick={onNext}>{t("guide.openCalculator")}<Calculator size={17} /></button></div></div>;
}

// Sub-stages whose calculator is a single Cement Works category.
const SUB_STAGE_CATEGORY: Record<string, string> = { plastering: "plastering", flooring: "flooring", slab: "slab", "stair-case": "staircase" };
function ComingSoon({ stage }: any) {
  const { t } = useApp();
  return <div className="coming-soon"><span><Calculator /></span><h2>{t("comingSoon.title", { stage: t(stage.id) })}</h2><p>{t("comingSoon.text")}</p><div className="tip-card"><Lightbulb /><div><strong>{t("comingSoon.whyTitle")}</strong><p>{t("comingSoon.whyText")}</p></div></div></div>;
}
function CalculatorHeader({ title }: { title: string }) {
  const { t } = useApp();
  return <div className="content-heading"><span className="eyebrow"><span />{t("calc.eyebrow")}</span><h2>{title}</h2><p>{t("calc.intro")}</p></div>;
}
function CalcField({ label, unit, value, onChange }: any) { return <label className="calc-field"><span>{label}</span><div><input type="number" min="0" step="any" value={value} onChange={e => onChange(Number(e.target.value))} /><em>{unit}</em></div></label>; }
function CalcFieldWithUnitSelect({ label, value, onChange, unit, onUnitChange, showAreaUnit = false }: any) {
  const { t } = useApp();
  const unitOptions = showAreaUnit ? [{ value: 'in²', label: 'in²' }, { value: 'cm²', label: 'cm²' }, { value: 'm²', label: 'm²' }, { value: 'ft²', label: 'ft²' }] : ALL_LENGTH_UNITS.map(u => ({ value: u, label: `${t(`unit.${u}`)} (${u})` }));
  // Older records saved "inches"/"foot"; show them as the matching shared unit code.
  const shown = showAreaUnit ? unit : toLengthUnit(unit) ?? unit;
  return <label className="calc-field"><span>{label}</span><div style={{display: 'flex', gap: '8px', alignItems: 'center'}}><input type="number" min="0" step="any" value={value} onChange={e => onChange(Number(e.target.value))} style={{flex: 1}} /><select value={shown} onChange={(e) => onUnitChange(e.target.value)} style={{padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', cursor: 'pointer', fontSize: '12px', minWidth: '80px'}}>{unitOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div></label>;
}
const listLabels = (t: Translate) => ({ view: t("view"), hide: t("hide"), edit: t("edit"), duplicate: t("duplicate"), delete: t("delete"), totals: t("common.combinedTotals"), calculations: t("common.calculationsCount"), confirmDelete: t("common.confirmDelete"), cancel: t("common.cancel") });
// Totals are summed by their stored English labels; only the displayed label is translated.
const localizeTotals = (rows: { label: string; value: string }[], tl: (label: string) => string) => rows.map(r => ({ ...r, label: tl(r.label) }));

// Material volumes are stored in one unit; this picker only changes how they are shown.
function VolumeUnitSelect({ value, onChange }: { value: VolumeUnit; onChange: (unit: VolumeUnit) => void }) {
  const { t } = useApp();
  return <label className="field" style={{ maxWidth: "320px" }}><span>{t("vol.showIn")}</span>
    <select value={value} onChange={e => onChange(isVolumeUnit(e.target.value) ? e.target.value : DEFAULT_VOLUME_UNIT)} style={{ minHeight: "44px", padding: "8px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)" }}>
      {VOLUME_UNITS.map(u => <option key={u} value={u}>{t(`vol.${u}`)}</option>)}
    </select></label>;
}
// Formats a stored result in the chosen volume unit (non-volume values pass through, translated).
function useQuantityText() {
  const { t, tv } = useApp();
  return (text: string, unit: VolumeUnit = DEFAULT_VOLUME_UNIT) => tv(displayVolume(text, unit, u => t(`volSym.${u}`)));
}
const outputUnitOf = (calc?: { outputUnit?: VolumeUnit } | null): VolumeUnit => (calc?.outputUnit && isVolumeUnit(calc.outputUnit) ? calc.outputUnit : DEFAULT_VOLUME_UNIT);

type FoundationSeed = { name: string; length: { value: number; unit: FoundationUnit }; width: { value: number; unit: FoundationUnit }; depth: { value: number; unit: FoundationUnit }; outputUnit: VolumeUnit };
const FOUNDATION_DEFAULTS: FoundationSeed = { name: "", length: { value: 180, unit: "ft" }, width: { value: 13, unit: "in" }, depth: { value: 2, unit: "ft" }, outputUnit: DEFAULT_VOLUME_UNIT };
const FOUNDATION_METHOD_KEY = { manual: "fnd.method.manual", plan: "fnd.method.plan" } as const;
const foundationSeedOf = (c: FoundationCalculation): FoundationSeed => ({
  name: c.name,
  length: { value: c.measurements.length.value, unit: c.measurements.length.unit },
  width: { value: c.measurements.width.value, unit: c.measurements.width.unit },
  depth: { value: c.measurements.depth.value, unit: c.measurements.depth.unit },
  outputUnit: outputUnitOf(c),
});

function PlanPreview({ plan, maxHeight = 160 }: { plan: FoundationPlanData; maxHeight?: number }) {
  const { t, planUrl } = useApp();
  const w = plan.canvas?.width || 600, h = plan.canvas?.height || 400;
  const src = planUrl(plan);
  return <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={plan.fileName ? `${t("fnd.planPreviewAria")} — ${plan.fileName}` : t("fnd.planPreviewAria")} style={{ width: "100%", maxHeight, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "6px" }}>
    {src && <image href={src} width={w} height={h} preserveAspectRatio="xMidYMid meet" opacity=".7" />}
    {plan.segments.map(s => <line key={s.id} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} style={{ stroke: "var(--green)", strokeWidth: 2.5, strokeLinecap: "round" }} />)}
  </svg>;
}

type QuantityText = (text: string, unit?: VolumeUnit) => string;
// English quantity text for the PDF (volumes in the record's display unit, e.g. "4.3 Cubes").
const englishQuantity: QuantityText = (text, unit = DEFAULT_VOLUME_UNIT) => displayVolume(text, unit);

// Every input, the ratio, base quantities, wastage and final quantities of one foundation (list, report and PDF).
function foundationRows(calc: FoundationCalculation, t: Translate, q: QuantityText): [string, string][] {
  const unit = outputUnitOf(calc);
  const { length: l, width: w, depth: d } = calc.measurements;
  const r = calculateFoundation({ lengthInches: l.inches, widthInches: w.inches, depthInches: d.inches, wastagePercent: calc.wastagePercent ?? FOUNDATION_WASTAGE_PERCENT });
  const pct = r.wastagePercent;
  return [
    [t("fnd.length"), `${fmtNum(l.value)} ${l.unit} = ${fmtNum(l.inches, 2)} in`],
    [t("fnd.width"), `${fmtNum(w.value)} ${w.unit} = ${fmtNum(w.inches, 2)} in`],
    [t("fnd.depth"), `${fmtNum(d.value)} ${d.unit} = ${fmtNum(d.inches, 2)} in`],
    [t("fnd.ratioLabel"), `5 : 40 : 100 (${t("fnd.ratioParts")})`],
    [`${t("label.Metal")} · ${t("fnd.base")}`, `${fmtNum(l.inches, 2)} × ${fmtNum(w.inches, 2)} × ${fmtNum(d.inches, 2)} ÷ 1,728 = ${q(`${r.metalVolumeCubicFeet} ft³`, unit)}`],
    [`${t("label.Sand")} · ${t("fnd.base")}`, `${t("label.Metal")} × 40 ÷ 100 = ${q(`${r.sandVolumeCubicFeet} ft³`, unit)}`],
    [`${t("label.Cement")} · ${t("fnd.base")}`, `${t("label.Metal")} × 5 ÷ 100 = ${q(`${r.cementVolumeCubicFeet} ft³`, unit)}`],
    [t("fnd.wastageLabel", { pct }), `× ${1 + pct / 100}`],
    [`${t("label.Metal")} · ${t("fnd.final")}`, q(`${r.metalFinalCubicFeet} ft³`, unit)],
    [`${t("label.Sand")} · ${t("fnd.final")}`, q(`${r.sandFinalCubicFeet} ft³`, unit)],
    [`${t("label.Cement")} · ${t("fnd.final")}`, q(`${r.cementFinalCubicFeet} ft³`, unit)],
    [t("label.Equivalent Cement Bags"), q(`${r.cementBags} bags`)],
    [t("vol.shownIn"), t(`vol.${unit}`)],
  ];
}

function FoundationDetails({ calc }: { calc: FoundationCalculation }) {
  const { t } = useApp();
  const q = useQuantityText();
  const line = (k: string, v: string) => <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "12px" }}><span style={{ color: "var(--muted)" }}>{k}</span><span style={{ textAlign: "right" }}>{v}</span></div>;
  return <div style={{ display: "grid", gap: "6px" }}>
    {foundationRows(calc, t, q).map(([k, v]) => line(k, v))}
    {calc.plan && <div style={{ marginTop: "8px" }}>
      <strong style={{ fontSize: "12px" }}>{t("fnd.planPreview")}</strong>
      <div style={{ margin: "8px 0" }}><PlanPreview plan={calc.plan} maxHeight={360} /></div>
      {calc.plan.segments.map((s, i) => line(t("fnd.line", { n: i + 1 }), `${fmtNum(s.realLength)} m`))}
    </div>}
  </div>;
}

function FoundationCalculator() {
  const { project, setProject, notify, t, tl } = useApp();
  const q = useQuantityText();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const calcs: FoundationCalculation[] = project.foundationCalculations || [];
  const editId = searchParams.get("edit");
  const fromReport = searchParams.get("from") === "report";
  const startEditing = editId ? calcs.find(c => c.id === editId) ?? null : null;
  const [screen, setScreen] = useState<"list" | "method" | "plan" | "form">(startEditing ? "form" : calcs.length ? "list" : "method");
  const [editing, setEditing] = useState<FoundationCalculation | null>(startEditing);
  const [method, setMethod] = useState<"manual" | "plan">(startEditing?.method ?? "manual");
  const [plan, setPlan] = useState<FoundationPlanData | null>(startEditing?.plan ?? null);
  const [seed, setSeed] = useState<FoundationSeed>(startEditing ? foundationSeedOf(startEditing) : FOUNDATION_DEFAULTS);

  const toList = () => { setEditing(null); setPlan(null); setSeed(FOUNDATION_DEFAULTS); setScreen("list"); if (editId) setSearchParams({}); };
  const startNew = () => { setEditing(null); setPlan(null); setSeed(FOUNDATION_DEFAULTS); setScreen("method"); };
  const startEdit = (id: string) => {
    const c = calcs.find(x => x.id === id);
    if (!c) return;
    setEditing(c); setMethod(c.method); setPlan(c.plan ?? null); setSeed(foundationSeedOf(c)); setScreen("form");
  };
  const update = (list: FoundationCalculation[], messageKey: string) => { setProject({ ...project, foundationCalculations: list }); notify(t(messageKey)); };

  const save = (draft: FoundationSeed) => {
    const calc = stampRecord(buildFoundationCalculation({
      id: editing?.id ?? makeId(),
      name: draft.name.trim() || editing?.name || defaultCalcName(t("fnd.defaultName"), calcs.length),
      method, length: draft.length, width: draft.width, depth: draft.depth,
      plan: method === "plan" && plan ? plan : undefined,
      meta: { outputUnit: draft.outputUnit, workStatus: editing?.workStatus ?? "ongoing" },
    }), editing);
    update(upsertById(calcs, calc), editing ? "fnd.updated" : "fnd.saved");
    if (fromReport) { nav("/report"); return; }
    toList();
  };

  if (screen === "method") return <div className="content-wrap">
    {calcs.length > 0 && <button className="back-link" onClick={toList}><ArrowLeft size={16} aria-hidden="true" /> {t("common.backToSaved")}</button>}
    <CalculatorHeader title={t("fnd.chooseMethod")} />
    <div className="method-grid">
      <Method icon={Ruler} badge={t("fnd.recommended")} title={t("fnd.manualTitle")} text={t("fnd.manualText")} button={t("fnd.manualButton")} onClick={() => { setMethod("manual"); setPlan(null); setScreen("form"); }} />
      <Method icon={Upload} badge={t("fnd.aiAssisted")} subtle title={t("fnd.planTitle")} text={t("fnd.planText")} button={t("fnd.planButton")} onClick={() => { setMethod("plan"); setPlan(null); setScreen("plan"); }} />
    </div>
    <Safety />
  </div>;

  if (screen === "plan") return <FoundationPlanner upload initial={plan} onBack={() => setScreen(editing || plan ? "form" : "method")} onContinue={p => {
    setPlan(p);
    setSeed(s => ({ ...s, length: { value: Number(p.totalLengthM.toFixed(4)), unit: "m" } }));
    setScreen("form");
  }} />;

  if (screen === "form") return <FoundationForm editing={editing} method={method} plan={plan} seed={seed}
    backLabel={editing ? t("common.backToSaved") : method === "plan" ? t("fnd.backToPlan") : t("fnd.changeMethod")}
    onBack={() => editing ? (fromReport ? nav("/report") : toList()) : setScreen(method === "plan" ? "plan" : "method")}
    onEditPlan={draft => { setSeed(draft); setScreen("plan"); }} onSave={save} />;

  const items: SavedItem[] = calcs.map(c => ({
    id: c.id,
    title: c.name,
    badge: t(FOUNDATION_METHOD_KEY[c.method]),
    rows: [
      [t("fnd.methodLabel"), t(FOUNDATION_METHOD_KEY[c.method])],
      [c.method === "plan" ? t("foundation-length") : t("fnd.length"), `${fmtNum(c.measurements.length.value)} ${c.measurements.length.unit}`],
      [t("fnd.width"), `${fmtNum(c.measurements.width.value)} ${c.measurements.width.unit}`],
      [t("fnd.depth"), `${fmtNum(c.measurements.depth.value)} ${c.measurements.depth.unit}`],
      ...c.results.map(r => [tl(r.label), q(r.value, outputUnitOf(c))] as [string, string]),
    ],
    workStatus: c.workStatus ?? "ongoing",
    preview: c.plan ? <PlanPreview plan={c.plan} /> : undefined,
    details: <FoundationDetails calc={c} />,
  }));
  return <div className="content-wrap">
    <div className="content-heading"><span className="eyebrow"><span />{t("calc.eyebrow")}</span><h2>{t("fnd.title")}</h2><p>{t("fnd.listText")}</p></div>
    <SavedCalculationList heading={t("fnd.listHeading")} items={items} labels={listLabels(t)}
      totals={localizeTotals(sumQuantities(calcs.map(c => c.results), TOTAL_LABELS.foundation), tl).map(r => ({ ...r, value: q(r.value) }))}
      addLabel={t(calcs.length ? "fnd.addAnother" : "fnd.add")} emptyText={t("fnd.empty")}
      onAdd={startNew} onEdit={startEdit}
      onDuplicate={id => update(duplicateById(calcs, id, c => stampRecord({ ...c, name: `${c.name} (${t("copy")})`, createdAt: undefined })), "fnd.duplicated")}
      onDelete={id => update(removeById(calcs, id), "fnd.deleted")}
      onToggleStatus={id => update(toggleWorkStatus(calcs, id), "status.updated")} />
  </div>;
}
function Method({ icon: Icon, badge, subtle, title, text, button, onClick }: any) { return <article className="method-card">{badge && <span className={`recommended ${subtle ? "subtle" : ""}`}>{badge}</span>}<span className="method-icon"><Icon /></span><h3>{title}</h3><p>{text}</p><button className="btn btn-secondary" onClick={onClick}>{button}<ArrowRight size={17} /></button></article>; }
function Safety() {
  const { t } = useApp();
  return <div className="safety"><Lightbulb /><p><strong>{t("safety.title")}</strong> {t("safety.text")}</p></div>;
}
function FoundationForm({ editing, method, plan, seed, backLabel, onBack, onEditPlan, onSave }: { editing: FoundationCalculation | null; method: "manual" | "plan"; plan: FoundationPlanData | null; seed: FoundationSeed; backLabel: string; onBack: () => void; onEditPlan: (draft: FoundationSeed) => void; onSave: (draft: FoundationSeed) => void }) {
  const { t } = useApp();
  const [name, setName] = useState(seed.name);
  const [lengthValue, setLengthValue] = useState(seed.length.value);
  const [lengthUnit, setLengthUnit] = useState<FoundationUnit>(seed.length.unit);
  const [widthValue, setWidthValue] = useState(seed.width.value);
  const [widthUnit, setWidthUnit] = useState<FoundationUnit>(seed.width.unit);
  const [depthValue, setDepthValue] = useState(seed.depth.value);
  const [depthUnit, setDepthUnit] = useState<FoundationUnit>(seed.depth.unit);
  const [outputUnit, setOutputUnit] = useState<VolumeUnit>(seed.outputUnit ?? DEFAULT_VOLUME_UNIT);
  const [showConversion, setShowConversion] = useState(false);
  const [error, setError] = useState("");
  const q = useQuantityText();
  const ft3 = (n: number) => q(`${n} ft³`, outputUnit);

  const compute = () => {
    const lengthInches = foundationToInches(lengthValue, lengthUnit);
    const widthInches = foundationToInches(widthValue, widthUnit);
    const depthInches = foundationToInches(depthValue, depthUnit);
    return { ...calculateFoundation({ lengthInches, widthInches, depthInches }), lengthInches, widthInches, depthInches };
  };
  // Results are only shown while they match the current inputs, so Save can never store stale numbers.
  // (The display unit is not part of the key: changing it never changes the quantities.)
  const inputKey = [lengthValue, lengthUnit, widthValue, widthUnit, depthValue, depthUnit].join("|");
  const [computed, setComputed] = useState<{ key: string; data: ReturnType<typeof compute> } | null>(() => editing ? { key: inputKey, data: compute() } : null);
  const calculation = computed && computed.key === inputKey ? computed.data : null;

  const draft = (): FoundationSeed => ({ name, length: { value: lengthValue, unit: lengthUnit }, width: { value: widthValue, unit: widthUnit }, depth: { value: depthValue, unit: depthUnit }, outputUnit });

  const handleCalculate = () => {
    setError("");
    const values = [lengthValue, widthValue, depthValue];
    if (values.some(v => !v)) { setError(t("fnd.err.missing")); return; }
    if (values.some(v => !Number.isFinite(v) || v <= 0)) { setError(t("fnd.err.positive")); return; }
    setComputed({ key: inputKey, data: compute() });
  };

  const handleSave = () => {
    if (!calculation) return;
    onSave(draft());
  };

  const box = { padding: '8px', minHeight: '44px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' } as const;
  const measureField = (labelKey: string, value: number, setValue: (v: number) => void, unit: FoundationUnit, setUnit: (u: FoundationUnit) => void, placeholder: string) =>
    <label><span>{t(labelKey)}</span><div style={{display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap'}}>
      <input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} style={{...box, flex: '1 1 120px', minWidth: 0}} placeholder={placeholder} />
      <select aria-label={`${t(labelKey)} – ${t("common.unit")}`} value={unit} onChange={(e) => setUnit(e.target.value as FoundationUnit)} style={{...box, flex: '1 1 110px'}}>{ALL_LENGTH_UNITS.map(u => <option key={u} value={u}>{t(`unit.${u}`)} ({u})</option>)}</select>
    </div></label>;
  const conversion = (labelKey: string, value: number, unit: FoundationUnit, inches: number) => <div style={{marginBottom: '12px'}}>
    <div style={{fontWeight: '600', marginBottom: '4px'}}>{t(labelKey)}</div>
    <div>{t("fnd.entered")}: {value} {unit}</div>
    <div>{t("fnd.converted")}: {inches.toFixed(2)} in</div>
  </div>;
  const step = (n: number, titleKey: string, lines: React.ReactNode[]) => <div>
    <div style={{fontWeight: '600', marginBottom: '4px'}}>{t("common.stepN", { n })}: {t(titleKey)}</div>
    {lines.map((l, i) => <div key={i}>{l}</div>)}
  </div>;
  const card = (labelKey: string, finalFt3: number, baseFt3: number, extra?: string) => <div style={{background: 'var(--surface)', padding: '16px', borderRadius: '8px', textAlign: 'center'}}>
    <div style={{fontSize: '12px', color: 'var(--muted)', marginBottom: '8px'}}>{t(labelKey).toUpperCase()}</div>
    <div style={{fontSize: '22px', fontWeight: '700', color: 'var(--text)'}}>{ft3(finalFt3)}</div>
    <div style={{fontSize: '11px', color: 'var(--muted)'}}>{t("fnd.inclWastage", { pct: FOUNDATION_WASTAGE_PERCENT })} · {t("fnd.base")}: {ft3(baseFt3)}</div>
    {extra && <div style={{fontSize: '12px', color: 'var(--text)', marginTop: '6px'}}>{extra}</div>}
  </div>;

  return <div className="content-wrap"><button className="back-link" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> {backLabel}</button><CalculatorHeader title={editing ? t("fnd.editTitle") : t("fnd.title")} /><div className="calculator-panel">
    {error && <div role="alert" style={{padding: '12px', background: '#8B3838', borderRadius: '6px', marginBottom: '12px', color: '#FFE5E5', fontSize: '13px'}}>{error}</div>}
    <label style={{display: 'block', marginBottom: '16px'}}><span>{t("common.calcName")}</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("fnd.namePh")} style={{...box, width: '100%', marginTop: '6px'}} /></label>
    <div style={{marginBottom: '16px', fontSize: '12px', color: 'var(--muted)'}}>{t("fnd.methodLabel")}: <strong style={{color: 'var(--text)'}}>{t(FOUNDATION_METHOD_KEY[method])}</strong></div>
    {method === "plan" && plan && <div style={{marginBottom: '16px'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap'}}><strong style={{fontSize: '13px'}}>{t("fnd.planPreview")}</strong><button type="button" className="btn btn-secondary" onClick={() => onEditPlan(draft())}>{t("fnd.editPlan")}</button></div>
      <PlanPreview plan={plan} maxHeight={220} />
      <small style={{display: 'block', marginTop: '6px', color: 'var(--muted)'}}>{t("fnd.tracedLength", { length: fmtNum(plan.totalLengthM) })}</small>
    </div>}
    <div className="form-grid">
      {measureField("foundation-length", lengthValue, setLengthValue, lengthUnit, setLengthUnit, "180")}
      {measureField("foundation-width", widthValue, setWidthValue, widthUnit, setWidthUnit, "13")}
      {measureField("foundation-depth", depthValue, setDepthValue, depthUnit, setDepthUnit, "2")}
    </div>
    <div className="mix-display"><span>{t("material-ratio")}</span><strong>5 : 40 : 100</strong><small>{t("fnd.ratioParts")}</small></div>
    <Safety />
    <button className="btn btn-primary btn-lg" onClick={handleCalculate} style={{width: '100%', marginBottom: '20px'}}><Calculator size={18} />{t("common.calculateMaterials")}</button>
    {calculation && <div style={{marginBottom: '20px'}}>
      <button onClick={() => setShowConversion(!showConversion)} aria-expanded={showConversion} style={{background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', textDecoration: 'underline', marginBottom: '16px', fontSize: '13px', fontWeight: '500', minHeight: '44px'}}>
        {showConversion ? `▼ ${t("fnd.hideConversion")}` : `▶ ${t("fnd.viewConversion")}`}
      </button>
      {showConversion && <div style={{background: 'var(--surface)', borderRadius: '8px', padding: '16px', marginBottom: '16px', fontSize: '12px', color: 'var(--muted)'}}>
        {conversion("foundation-length", lengthValue, lengthUnit, calculation.lengthInches)}
        {conversion("foundation-width", widthValue, widthUnit, calculation.widthInches)}
        {conversion("foundation-depth", depthValue, depthUnit, calculation.depthInches)}
      </div>}
      <div style={{background: 'var(--surface)', borderRadius: '8px', padding: '16px', marginBottom: '16px'}}>
        <h3 style={{marginBottom: '16px', fontSize: '14px', fontWeight: '600'}}>{t("calculation-process").toUpperCase()}</h3>
        <div style={{fontSize: '12px', color: 'var(--muted)', display: 'grid', gap: '12px'}}>
          {step(1, "fnd.step1", [`${t("fnd.length")}: ${lengthValue} ${lengthUnit}`, `${t("fnd.width")}: ${widthValue} ${widthUnit}`, `${t("fnd.depth")}: ${depthValue} ${depthUnit}`])}
          {step(2, "fnd.step2", [`${t("fnd.length")}: ${calculation.lengthInches.toFixed(2)} in`, `${t("fnd.width")}: ${calculation.widthInches.toFixed(2)} in`, `${t("fnd.depth")}: ${calculation.depthInches.toFixed(2)} in`])}
          {step(3, "fnd.step3", [`${calculation.lengthInches.toFixed(2)} × ${calculation.widthInches.toFixed(2)} × ${calculation.depthInches.toFixed(2)} = ${calculation.metalVolumeCubicInches.toLocaleString()} in³`])}
          {step(4, "fnd.step4", [`${calculation.metalVolumeCubicInches.toLocaleString()} ÷ 1,728 = ${calculation.metalVolumeCubicFeet} ft³`, <span style={{color: 'var(--text)', fontWeight: '600'}}>{t("fnd.totalMetal")}: {calculation.metalVolumeCubicFeet} ft³</span>])}
          {step(5, "fnd.step5", [`${calculation.metalVolumeCubicFeet} × (40 ÷ 100) = ${calculation.sandVolumeCubicFeet} ft³`])}
          {step(6, "fnd.step6", [`${calculation.metalVolumeCubicFeet} × (5 ÷ 100) = ${calculation.cementVolumeCubicFeet} ft³`])}
          {step(7, "fnd.step7", [
            t("fnd.wastageLabel", { pct: calculation.wastagePercent }),
            `${t("label.Metal")}: ${calculation.metalVolumeCubicFeet} × ${1 + calculation.wastagePercent / 100} = ${fmtNum(calculation.metalFinalCubicFeet)} ft³ = ${q(`${calculation.metalFinalCubicFeet} ft³`, "cube")}`,
            `${t("label.Sand")}: ${calculation.sandVolumeCubicFeet} × ${1 + calculation.wastagePercent / 100} = ${fmtNum(calculation.sandFinalCubicFeet)} ft³ = ${q(`${calculation.sandFinalCubicFeet} ft³`, "cube")}`,
            `${t("label.Cement")}: ${calculation.cementVolumeCubicFeet} × ${1 + calculation.wastagePercent / 100} = ${fmtNum(calculation.cementFinalCubicFeet)} ft³ = ${q(`${calculation.cementFinalCubicFeet} ft³`, "cube")}`,
            t("fnd.cubeNote"),
          ])}
        </div>
      </div>
      <h3 style={{marginBottom: '16px', fontSize: '16px', fontWeight: '600'}}>{t("fnd.estimate").toUpperCase()}</h3>
      <VolumeUnitSelect value={outputUnit} onChange={setOutputUnit} />
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '16px', margin: '12px 0 20px'}}>
        {card("label.Metal", calculation.metalFinalCubicFeet, calculation.metalVolumeCubicFeet)}
        {card("label.Sand", calculation.sandFinalCubicFeet, calculation.sandVolumeCubicFeet)}
        {card("label.Cement", calculation.cementFinalCubicFeet, calculation.cementVolumeCubicFeet, `${t("label.Equivalent Cement Bags")}: ${q(`${calculation.cementBags} bags`)}`)}
      </div>
      <button className="btn btn-primary" onClick={handleSave} style={{width: '100%', minHeight: '44px'}}>{editing ? t("common.saveChanges") : t("common.saveCalculation")}</button>
    </div>}
    </div>
  </div>;
}
// Keeps the stored plan preview small enough for browser storage.
function downscaleImage(src: string, maxDim = 1000): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(src); return; }
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

const PLAN_LENGTH_UNITS: UnitType[] = ["mm", "m", "inch", "foot"];
const UNIT_SYMBOL: Record<UnitType, string> = { mm: "mm", cm: "cm", m: "m", inch: "in", foot: "ft", cubic_feet: "ft³", cubic_inches: "in³" };

function FoundationPlanner({ upload, initial, onBack, onContinue }: { upload: boolean; initial: FoundationPlanData | null; onBack: () => void; onContinue: (plan: FoundationPlanData) => void }) {
  const { notify, t, planUrl } = useApp();
  const [segments, setSegments] = useState<Segment[]>(initial?.segments ?? []);
  const [pending, setPending] = useState<any>(null);
  const [drawing, setDrawing] = useState(true);
  const [image, setImage] = useState<string | null>(planUrl(initial) ?? null);
  // A newly chosen file replaces the stored plan; otherwise the existing stored plan (planId) is kept.
  const [newFileName, setNewFileName] = useState<string | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [editingLength, setEditingLength] = useState("");
  const [editingUnit, setEditingUnit] = useState<UnitType>("m");
  const [displayUnit, setDisplayUnit] = useState<UnitType>("m");
  const svgRef = useRef<SVGSVGElement>(null);

  const total = segments.reduce((sum, s) => sum + (s.included ? s.realLength : 0), 0);


  function point(e: React.PointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: Math.round((e.clientX - rect.left) / 20) * 20, y: Math.round((e.clientY - rect.top) / 20) * 20 };
  }

  function down(e: React.PointerEvent) {
    if (!drawing) return;
    setPending({ ...point(e), x2: point(e).x, y2: point(e).y });
  }

  function move(e: React.PointerEvent) {
    if (pending) setPending({ ...pending, x2: point(e).x, y2: point(e).y });
  }

  function up() {
    if (!pending || (pending.x === pending.x2 && pending.y === pending.y2)) {
      setPending(null);
      return;
    }
    const px = Math.hypot(pending.x2 - pending.x, pending.y2 - pending.y);
    const estimatedLength = (px / 40).toFixed(2);
    const newSegment = {
      id: crypto.randomUUID(),
      x1: pending.x,
      y1: pending.y,
      x2: pending.x2,
      y2: pending.y2,
      realLength: 0,
      included: true
    };
    setSegments([...segments, newSegment]);
    setEditingSegmentId(newSegment.id);
    setEditingLength(estimatedLength);
    setPending(null);
  }

  function handleSaveLength() {
    if (!editingSegmentId) return;
    const length = parseFloat(editingLength);
    if (!Number.isFinite(length) || length <= 0) {
      notify(t("plan.err.length"));
      return;
    }
    const lengthInMeters = convertToMeters(length, editingUnit);
    setSegments(segments.map(s => s.id === editingSegmentId ? { ...s, realLength: lengthInMeters } : s));
    setEditingSegmentId(null);
    setEditingLength("");
    setEditingUnit("m");
  }

  function handleSkipLength() {
    setEditingSegmentId(null);
    setEditingLength("");
  }

  function handleDeleteSegment(id: string) {
    setSegments(segments.filter(s => s.id !== id));
    if (editingSegmentId === id) {
      setEditingSegmentId(null);
      setEditingLength("");
    }
  }

  function handleUpload(file?: File) {
    if (!file || !["image/png", "image/jpeg"].includes(file.type)) { if (file) notify(t("err.unsupportedFile")); return; }
    const reader = new FileReader();
    reader.onload = () => downscaleImage(String(reader.result)).then(src => { setImage(src); setNewFileName(file.name); });
    reader.readAsDataURL(file);
  }

  return (
    <div className="planner-page">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> {t("fnd.changeMethod")}</button>
      <div className="content-heading">
        <span className="eyebrow"><span />{t("plan.eyebrow")}</span>
        <h2>{t("plan.title")}</h2>
        <p>{t("plan.text")}</p>
      </div>
      {upload && !image && (
        <label className="uploader" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files[0]); }}>
          <Upload />
          <h3>{t("plan.uploadTitle")}</h3>
          <p>{t("plan.uploadText")}</p>
          <input type="file" accept=".png,.jpg,.jpeg" onChange={e => handleUpload(e.target.files?.[0])} />
          <span className="btn btn-secondary">{t("plan.chooseImage")}</span>
        </label>
      )}
      {(!upload || image) && (
        <div className="planner-layout">
          <div className="canvas-card">
            <div className="planner-toolbar">
              <button className={drawing ? "active" : ""} onClick={() => setDrawing(true)}><Pencil />{t("plan.draw")}</button>
              <button className={!drawing ? "active" : ""} onClick={() => setDrawing(false)}><Ruler />{t("plan.select")}</button>
              <button onClick={() => setSegments(segments.slice(0, -1))}><Undo2 />{t("plan.undo")}</button>
              <button onClick={() => setSegments([])}><Trash2 />{t("plan.clear")}</button>
            </div>
            <svg ref={svgRef} className="planner-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} aria-label={t("plan.canvasLabel")}>
              <defs>
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M20 0H0V20" fill="none" />
                </pattern>
              </defs>
              {image && <image href={image} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" opacity=".55" pointerEvents="none" />}
              <rect width="100%" height="100%" fill="url(#grid)" pointerEvents="none" />
              {segments.map(s => (
                <g key={s.id} style={{ cursor: "pointer" }} onClick={() => !editingSegmentId && setEditingSegmentId(s.id)}>
                  <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
                  <text x={(s.x1 + s.x2) / 2} y={(s.y1 + s.y2) / 2 - 8}>{s.realLength > 0 ? s.realLength.toFixed(2) : "?"} m</text>
                </g>
              ))}
              {pending && <line className="pending" x1={pending.x} y1={pending.y} x2={pending.x2} y2={pending.y2} />}
            </svg>
            <p className="canvas-help">{t("plan.help")}</p>
            {editingSegmentId && (
              <div style={{ marginTop: "16px", padding: "12px", background: "var(--surface)", borderRadius: "8px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "8px", alignItems: "flex-end" }}>
                  <label style={{ display: "block", flex: "1 1 160px" }}>
                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>{t("plan.enterLength")}</span>
                    <input type="number" value={editingLength} onChange={e => setEditingLength(e.target.value)} placeholder="0.00" step="0.01" autoFocus
                      style={{ width: "100%", marginTop: "4px", padding: "8px", minHeight: "44px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }} />
                  </label>
                  <select aria-label={t("common.unit")} value={editingUnit} onChange={e => setEditingUnit(e.target.value as UnitType)}
                    style={{ padding: "8px", minHeight: "44px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--bg)", color: "inherit", cursor: "pointer", fontFamily: "inherit" }}>
                    {PLAN_LENGTH_UNITS.map(u => <option key={u} value={u}>{t(`unitType.${u}`)}</option>)}
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <button className="btn btn-primary" onClick={handleSaveLength}>{t("save")}</button>
                  <button className="btn btn-secondary" onClick={handleSkipLength}>{t("plan.nextLine")}</button>
                </div>
                <button style={{ width: "100%", marginTop: "8px", padding: "6px", minHeight: "44px", background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "12px" }} onClick={() => handleDeleteSegment(editingSegmentId)}>{t("plan.deleteLine")}</button>
              </div>
            )}
          </div>
          <aside className="plan-summary">
            <span className="eyebrow"><span />{t("plan.summaryEyebrow")}</span>
            <h3>{t("plan.summaryTitle")}</h3>
            <label style={{display: 'block', marginBottom: '12px'}}><span style={{fontSize: '12px', color: 'var(--muted)'}}>{t("plan.displayIn")}</span><select value={displayUnit} onChange={(e) => setDisplayUnit(e.target.value as UnitType)} style={{width: '100%', marginTop: '4px', padding: '8px', minHeight: '44px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)'}}>{PLAN_LENGTH_UNITS.map(u => <option key={u} value={u}>{t(`unitType.${u}`)}</option>)}</select></label>
            <div className="summary-row"><span>{t("plan.lines")}</span><strong>{segments.length}</strong></div>
            <div className="summary-row"><span>{t("plan.measured")}</span><strong>{segments.filter(s => s.realLength > 0).length}</strong></div>
            <div className="summary-row"><span>{t("plan.missing")}</span><strong>{segments.filter(s => s.realLength === 0).length}</strong></div>
            <div style={{marginBottom: '12px'}}><span style={{fontSize: '12px', fontWeight: '600'}}>{t("plan.individualLines")}</span>
              <div style={{maxHeight: '150px', overflowY: 'auto', marginTop: '8px', display: 'grid', gap: '6px'}}>
                {segments.map((s, idx) => <div key={s.id} style={{padding: '8px', background: 'var(--card)', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', fontSize: '12px'}}>
                  <div><strong>{t("fnd.line", { n: idx + 1 })}:</strong> {convertFromMeters(s.realLength, displayUnit).toFixed(2)} {UNIT_SYMBOL[displayUnit]}</div>
                  <button onClick={() => {setEditingSegmentId(s.id); setEditingLength(convertFromMeters(s.realLength, editingUnit).toFixed(2));}} style={{padding: '4px 8px', minHeight: '32px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: 'var(--text)'}}>{t("edit")}</button>
                </div>)}
              </div>
            </div>
            <div className="total-length"><span>{t("foundation-length")}</span><strong>{convertFromMeters(total, displayUnit).toFixed(2)} <small>{UNIT_SYMBOL[displayUnit]}</small></strong></div>
            <div className={`plan-status ${total ? "ready" : ""}`}>{total ? <CheckCircle2 /> : <Circle />}{total ? t("plan.ready") : t("plan.firstLine")}</div>
            <button disabled={!total || segments.some(s => s.realLength === 0)} className="btn btn-primary full" onClick={() => {
              const rect = svgRef.current?.getBoundingClientRect();
              const keepStored = !newFileName && initial?.planId;
              onContinue({
                segments, totalLengthM: total, canvas: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : undefined,
                // Cloud mode uploads the new image on save; local mode stores it in the browser as before.
                ...(keepStored ? { planId: initial?.planId, fileName: initial?.fileName } : { image: image ?? undefined, fileName: newFileName ?? initial?.fileName }),
              });
              notify(t("plan.traced"));
            }}>{t("common.continue")}<ArrowRight /></button>
            <Safety />
          </aside>
        </div>
      )}
    </div>
  );
}

const fmtNum = (n: number, digits = 3) => n.toLocaleString(undefined, { maximumFractionDigits: digits });
const STIRRUP_STANDARD_SIZE = "6 mm / 1/4\"";
const unitLabel = (t: (k: string) => string, u: string) => t(`unit.${u}`);

function LengthField({ label, help, value, unit, units = LENGTH_UNITS, onValue, onUnit, t, requireUnitChoice = true }: { label: string; help?: string; value: string; unit: string; units?: LengthUnit[]; onValue: (v: string) => void; onUnit: (u: string) => void; t: (k: string) => string; requireUnitChoice?: boolean }) {
  const box = { padding: '10px', minHeight: '44px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' } as const;
  return <label>
    <span>{label}</span>
    <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
      <input type="number" min="0" step="any" value={value} onChange={e => onValue(e.target.value)} style={{...box, flex: '1 1 120px', minWidth: 0}} />
      <select value={unit} onChange={e => onUnit(e.target.value)} style={{...box, flex: '1 1 130px'}}>
        {requireUnitChoice && <option value="">{t("rebar.selectUnit")}</option>}
        {units.map(u => <option key={u} value={u}>{unitLabel(t, u)}</option>)}
      </select>
    </div>
    {help && <small style={{color: 'var(--muted)'}}>{help}</small>}
  </label>;
}

function BarLapDiagram({ bars, stock, lap, required, vertical, t }: { bars: number; stock: number; lap: number; required: number; vertical: boolean; t: (k: string) => string }) {
  const step = stock - lap;
  const covered = bars * stock - (bars - 1) * lap;
  const span = Math.max(covered, required);
  const len = vertical ? 300 : 560;
  const pos = (a: number) => 20 + (a / span) * len;
  const showAll = bars <= 8;
  const pt = (a: number, c: number) => vertical ? { x: c, y: 20 + len - (pos(a) - 20) } : { x: pos(a), y: c };
  const colors = ["#22C55E", "#4ADE80"];
  const laneC = (i: number) => (vertical ? 120 : 56) + (i % 2) * 16;
  const items = Array.from({ length: bars }, (_, i) => ({ start: i * step, end: i * step + stock, i }));
  const textStyle = { fill: 'var(--muted)', fontSize: '11px', fontFamily: 'Inter, sans-serif' } as const;
  const reqA = pt(required, vertical ? 70 : 30), reqB = pt(required, vertical ? 170 : 92);
  return <div style={{background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', marginBottom: '20px'}}>
    <h3 style={{fontSize: '14px', fontWeight: 600, marginBottom: '8px'}}>{t("rebar.diagram")}</h3>
    <svg viewBox={vertical ? `0 0 300 ${len + 40}` : `0 0 600 130`} style={{width: '100%', maxWidth: vertical ? '300px' : '600px', height: 'auto', display: 'block', margin: '0 auto'}} role="img" aria-label={t("rebar.diagram")}>
      {items.slice(0, -1).map(({ end, i }) => {
        const a = pt((i + 1) * step, vertical ? 112 : 48), b = pt(end, vertical ? 144 : 80);
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        const lbl = pt(((i + 1) * step + end) / 2, vertical ? 152 : 110);
        return <g key={`lap${i}`}>
          <rect x={x} y={y} width={Math.max(2, Math.abs(b.x - a.x))} height={Math.max(2, Math.abs(b.y - a.y))} fill="#4ADE80" opacity={0.18} />
          {(showAll || i === 0) && <text x={lbl.x} y={lbl.y + (vertical ? 4 : 0)} textAnchor={vertical ? "start" : "middle"} style={textStyle}>{fmtNum(lap)} ft {t("rebar.lap")}</text>}
        </g>;
      })}
      {items.map(({ start, end, i }) => {
        const a = pt(start, laneC(i)), b = pt(end, laneC(i));
        const mid = pt((start + end) / 2, vertical ? 108 : 36);
        return <g key={`bar${i}`}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colors[i % 2]} strokeWidth={6} strokeLinecap="round" />
          {(showAll || i === 0) && <text x={mid.x} y={mid.y + (vertical ? 4 : 0)} textAnchor={vertical ? "end" : "middle"} style={textStyle}>{fmtNum(stock)} ft {t("rebar.bar")} {i + 1}</text>}
        </g>;
      })}
      <line x1={reqA.x} y1={reqA.y} x2={reqB.x} y2={reqB.y} stroke="var(--muted)" strokeDasharray="4 3" />
      <text x={vertical ? 175 : reqB.x} y={vertical ? reqB.y + 4 : 124} textAnchor={vertical ? "start" : "middle"} style={textStyle}>{fmtNum(required)} ft {t("rebar.required")}</text>
    </svg>
    {!showAll && <small style={{display: 'block', color: 'var(--muted)', marginTop: '4px'}}>{bars} {t("rebar.barsShown")}</small>}
    <small style={{display: 'block', color: 'var(--muted)', marginTop: '6px'}}>{t("rebar.diagramNote")}</small>
  </div>;
}

function ReinforcementSummary({ calc }: { calc: ReinforcementCalculation }) {
  const { t } = useApp();
  const r = calc.results;
  const m = (v?: MeasuredValue) => v ? `${fmtNum(v.value)} ${v.unit}` : "";
  const rows: [string, string][] = [
    [t(`rebar.length.${calc.memberType}`), `${m(calc.memberLength)}${calc.memberLength.unit !== "ft" ? ` (${fmtNum(r.memberLengthFt)} ft)` : ""}`],
    ...(calc.memberWidth ? [[t("rebar.widthShort"), m(calc.memberWidth)] as [string, string]] : []),
    ...(calc.memberDepth ? [[t("rebar.depthShort"), m(calc.memberDepth)] as [string, string]] : []),
    [t(`rebar.count.${calc.memberType}`), String(calc.memberCount)],
    [t("rebar.mainBarSize"), calc.mainBarDiameter || "—"],
    ...calc.barGroups.filter(g => g.count > 0).map(g => [t(`rebar.group.${g.key}`), String(g.count)] as [string, string]),
    [t("rebar.stockLength"), `${fmtNum(calc.stockBarLengthFt)} ft`],
    [t("rebar.lapLength"), `${fmtNum(calc.lapLengthFt)} ft`],
    [t("rebar.barsPerRun"), String(r.barsPerRun)],
    [t("rebar.runs"), String(r.totalRuns)],
    [t("rebar.totalBars"), String(r.totalStockBars)],
    [t("rebar.totalPurchased"), `${fmtNum(r.totalPurchasedFt)} ft`],
    [t("rebar.totalLap"), `${fmtNum(r.totalLapLengthFt)} ft`],
  ];
  const s = r.stirrups;
  const stirRows: [string, string][] = calc.stirrup && s ? [
    [t("rebar.stirrupSize"), calc.stirrup.size],
    [t("rebar.spacing"), m(calc.stirrup.spacing)],
    [t("rebar.stirrupCount"), String(s.total)],
    [t("rebar.cutLength"), m(calc.stirrup.cutLength)],
    [t("rebar.totalStirrup"), `${fmtNum(s.totalLengthFt)} ft`],
    [t("rebar.stirrupBars"), String(s.stockBars)],
  ] : [[t("rebar.stirrups"), t("rebar.notIncluded")]];
  const list = (items: [string, string][]) => items.map(([k, v]) => <div key={k} style={{display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '13px'}}><span style={{color: 'var(--muted)'}}>{k}</span><strong style={{textAlign: 'right'}}>{v}</strong></div>);
  return <div style={{display: 'grid', gap: '6px', marginTop: '12px'}}>
    {list(rows)}
    <div style={{fontSize: '12px', fontWeight: 600, marginTop: '6px'}}>{t("rebar.stirrups").toUpperCase()}</div>
    {list(stirRows)}
  </div>;
}

function ReinforcementCalculator({ memberType, initial, concreteOptions, onSave, onBack }: { memberType: MemberType; initial: ReinforcementCalculation | null; concreteOptions: CementWorksCalculation[]; onSave: (calc: ReinforcementCalculation) => void; onBack: () => void }) {
  const { t } = useApp();
  const str = (n?: number) => n === undefined ? "" : String(n);
  const groupKeys = BAR_GROUPS[memberType];
  const [name, setName] = useState(initial?.calculationName ?? "");
  const [linkId, setLinkId] = useState(initial?.linkedConcreteId ?? "");
  const [lenV, setLenV] = useState(str(initial?.memberLength.value));
  const [lenU, setLenU] = useState<string>(initial?.memberLength.unit ?? "");
  const [widV, setWidV] = useState(str(initial?.memberWidth?.value));
  const [widU, setWidU] = useState<string>(initial?.memberWidth?.unit ?? "");
  const [depV, setDepV] = useState(str(initial?.memberDepth?.value));
  const [depU, setDepU] = useState<string>(initial?.memberDepth?.unit ?? "");
  const [count, setCount] = useState(initial ? String(initial.memberCount) : "1");
  const [groups, setGroups] = useState<Record<string, string>>(() => Object.fromEntries(groupKeys.map(k => [k, str(initial?.barGroups.find(g => g.key === k)?.count)])));
  const [diameter, setDiameter] = useState(initial?.mainBarDiameter ?? "");
  const [stock, setStock] = useState(initial ? String(initial.stockBarLengthFt) : "19.5");
  const [lap, setLap] = useState(initial ? String(initial.lapLengthFt) : "1.5");
  const [stirOn, setStirOn] = useState(initial ? initial.stirrup !== null : true);
  const initialSize = initial?.stirrup?.size ?? STIRRUP_STANDARD_SIZE;
  const [sizeChoice, setSizeChoice] = useState(initialSize === STIRRUP_STANDARD_SIZE ? "standard" : "other");
  const [sizeOther, setSizeOther] = useState(initialSize === STIRRUP_STANDARD_SIZE ? "" : initialSize);
  const [spacingV, setSpacingV] = useState(str(initial?.stirrup?.spacing.value));
  const [spacingU, setSpacingU] = useState<string>(initial?.stirrup?.spacing.unit ?? "");
  const [conv, setConv] = useState<StirrupConvention>(initial?.stirrup?.convention ?? "both-ends");
  const [cutV, setCutV] = useState(str(initial?.stirrup?.cutLength.value));
  const [cutU, setCutU] = useState<string>(initial?.stirrup?.cutLength.unit ?? "ft");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReinforcementCalculation | null>(null);
  useEffect(() => { setResult(null); }, [name, linkId, lenV, lenU, widV, widU, depV, depU, count, groups, diameter, stock, lap, stirOn, sizeChoice, sizeOther, spacingV, spacingU, conv, cutV, cutU]);

  const box = { padding: '10px', minHeight: '44px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', width: '100%' } as const;
  const num = (s: string) => s.trim() === "" ? NaN : Number(s);
  const stockN = num(stock), lapN = num(lap);
  const effectivePreview = Number.isFinite(stockN) && Number.isFinite(lapN) && lapN >= 0 && lapN < stockN ? fmtNum(stockN - lapN) : "—";

  const handleCalculate = () => {
    setError("");
    setResult(null);
    const missingUnit = !lenU || (widV.trim() && !widU) || (depV.trim() && !depU) || (stirOn && (!spacingU || !cutU));
    if (missingUnit) { setError(t("rebar.err.unitMissing")); return; }
    const input: ReinforcementInput = {
      memberType,
      calculationName: name.trim() || `${t(`rebar.member.${memberType}`)} — ${t("rebar.short")}`,
      linkedConcreteId: linkId || undefined,
      memberLength: { value: num(lenV), unit: lenU as LengthUnit },
      memberWidth: widV.trim() ? { value: num(widV), unit: widU as LengthUnit } : undefined,
      memberDepth: depV.trim() ? { value: num(depV), unit: depU as LengthUnit } : undefined,
      memberCount: num(count),
      mainBarDiameter: diameter.trim() || undefined,
      barGroups: groupKeys.map(k => ({ key: k, count: groups[k].trim() === "" && k === "additional" ? 0 : num(groups[k]) })),
      stockBarLengthFt: stockN,
      lapLengthFt: lapN,
      stirrup: stirOn ? {
        size: sizeChoice === "standard" ? STIRRUP_STANDARD_SIZE : sizeOther.trim(),
        spacing: { value: num(spacingV), unit: spacingU as LengthUnit },
        cutLength: { value: num(cutV), unit: cutU as LengthUnit },
        convention: conv,
      } : null,
    };
    const invalid = validateReinforcement(input);
    if (invalid) { setError(t(invalid)); return; }
    setResult({ ...input, id: initial?.id ?? crypto.randomUUID(), results: calculateReinforcement(input) });
  };

  const c = result, r = result?.results;
  const step = (n: number, key: string) => `${t("rebar.step")} ${n}: ${t(`rebar.step.${key}`)}`;
  const steps: [string, string[]][] = c && r ? [
    [step(1, "required"), [c.memberLength.unit === "ft" ? `${fmtNum(r.memberLengthFt)} ft` : `${fmtNum(c.memberLength.value)} ${c.memberLength.unit} = ${fmtNum(r.memberLengthFt)} ft`]],
    [step(2, "stock"), [`${fmtNum(c.stockBarLengthFt)} ft`]],
    [step(3, "lap"), [`${fmtNum(c.lapLengthFt)} ft`]],
    [step(4, "effective"), [`${fmtNum(c.stockBarLengthFt)} − ${fmtNum(c.lapLengthFt)} = ${fmtNum(r.effectiveAdditionalLengthFt)} ft`]],
    [step(5, "barsPerRun"), r.barsPerRun === 1
      ? [`${fmtNum(r.memberLengthFt)} ft ≤ ${fmtNum(c.stockBarLengthFt)} ft → 1`, t("rebar.oneBarEnough")]
      : [`1 + ceil((${fmtNum(r.memberLengthFt)} − ${fmtNum(c.stockBarLengthFt)}) ÷ ${fmtNum(r.effectiveAdditionalLengthFt)})`,
         `= 1 + ceil(${fmtNum(r.memberLengthFt - c.stockBarLengthFt)} ÷ ${fmtNum(r.effectiveAdditionalLengthFt)}) = 1 + ${r.barsPerRun - 1} = ${r.barsPerRun}`]],
    [step(6, "laps"), [`${r.barsPerRun} − 1 = ${r.lapsPerRun}`]],
    [step(7, "lapTotal"), [`${r.lapsPerRun} × ${fmtNum(c.lapLengthFt)} = ${fmtNum(r.lapLengthPerRunFt)} ft`]],
    [step(8, "purchased"), [`${r.barsPerRun} × ${fmtNum(c.stockBarLengthFt)} = ${fmtNum(r.purchasedPerRunFt)} ft`]],
    [step(9, "effectiveLen"), [`${fmtNum(r.purchasedPerRunFt)} − ${fmtNum(r.lapLengthPerRunFt)} = ${fmtNum(r.effectivePerRunFt)} ft`]],
    [step(10, "excess"), [`${fmtNum(r.effectivePerRunFt)} − ${fmtNum(r.memberLengthFt)} = ${fmtNum(r.excessPerRunFt)} ft`]],
    [step(11, "runs"), [`(${c.barGroups.map(g => g.count).join(" + ")}) × ${c.memberCount} = ${r.totalRuns}`]],
    [step(12, "totalBars"), [`${r.barsPerRun} × ${r.totalRuns} = ${r.totalStockBars}`]],
    [step(13, "totalPurchased"), [`${r.totalStockBars} × ${fmtNum(c.stockBarLengthFt)} = ${fmtNum(r.totalPurchasedFt)} ft`]],
    [step(14, "totalLap"), [`${r.lapsPerRun} × ${r.totalRuns} × ${fmtNum(c.lapLengthFt)} = ${fmtNum(r.totalLapLengthFt)} ft`]],
    ...(c.stirrup && r.stirrups ? [
      [step(15, "stirNormalize"), [`L = ${fmtNum(r.memberLengthFt)} ft`, `s = ${fmtNum(c.stirrup.spacing.value)} ${c.stirrup.spacing.unit} = ${fmtNum(r.stirrups.spacingFt, 4)} ft`]],
      [step(16, "stirCount"), [c.stirrup.convention === "both-ends"
        ? `ceil(${fmtNum(r.memberLengthFt)} ÷ ${fmtNum(r.stirrups.spacingFt, 4)}) + 1 = ceil(${fmtNum(r.stirrups.spacesRatio)}) + 1 = ${r.stirrups.perMember}`
        : `ceil(${fmtNum(r.memberLengthFt)} ÷ ${fmtNum(r.stirrups.spacingFt, 4)}) = ceil(${fmtNum(r.stirrups.spacesRatio)}) = ${r.stirrups.perMember}`]],
      [step(17, "stirTotal"), [`${r.stirrups.perMember} × ${c.memberCount} = ${r.stirrups.total}`]],
      [step(18, "stirCut"), [c.stirrup.cutLength.unit === "ft" ? `${fmtNum(r.stirrups.cutLengthFt)} ft` : `${fmtNum(c.stirrup.cutLength.value)} ${c.stirrup.cutLength.unit} = ${fmtNum(r.stirrups.cutLengthFt)} ft`]],
      [step(19, "stirLength"), [`${r.stirrups.total} × ${fmtNum(r.stirrups.cutLengthFt)} = ${fmtNum(r.stirrups.totalLengthFt)} ft`]],
      [step(20, "stirBars"), [`ceil(${fmtNum(r.stirrups.totalLengthFt)} ÷ ${fmtNum(c.stockBarLengthFt)}) = ${r.stirrups.stockBars}`]],
    ] as [string, string[]][] : []),
  ] : [];

  const Row = ({ k, v }: { k: string; v: string }) => <div style={{display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: '13px'}}><span style={{color: 'var(--muted)'}}>{k}</span><strong style={{textAlign: 'right'}}>{v}</strong></div>;
  const sectionTitle = (text: string) => <p style={{fontSize: '13px', fontWeight: 600, color: 'var(--text)', margin: '20px 0 12px'}}>{text.toUpperCase()}</p>;

  return <div className="content-wrap">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> {t("back")}</button>
    <div className="content-heading"><span className="eyebrow"><span />{t(`rebar.member.${memberType}`).toUpperCase()} · {t("rebar.short").toUpperCase()}</span><h2>{initial ? t("rebar.editTitle") : t("rebar.title")}</h2><p>{t("rebar.intro")}</p></div>
    <div className="assumption" style={{marginBottom: '16px'}}><Lightbulb /><span>{t("rebar.info")}</span></div>
    <div className="calculator-panel">
      {error && <div role="alert" style={{padding: '12px', background: '#8B3838', borderRadius: '6px', marginBottom: '12px', color: '#FFE5E5', fontSize: '13px'}}>{error}</div>}
      <div className="form-grid">
        <label><span>{t("rebar.calcName")}</span><input style={box} value={name} onChange={e => setName(e.target.value)} placeholder={t(`rebar.namePh.${memberType}`)} /></label>
        <label><span>{t("rebar.linkConcrete")}</span><select style={box} value={linkId} onChange={e => setLinkId(e.target.value)}>
          <option value="">{t("rebar.noLink")}</option>
          {concreteOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select></label>
      </div>

      {sectionTitle(t("rebar.memberDetails"))}
      <div className="form-grid">
        <LengthField t={t} label={t(`rebar.length.${memberType}`)} value={lenV} unit={lenU} onValue={setLenV} onUnit={setLenU} />
        <LengthField t={t} label={t("rebar.width")} value={widV} unit={widU} onValue={setWidV} onUnit={setWidU} />
        <LengthField t={t} label={t("rebar.depth")} value={depV} unit={depU} onValue={setDepV} onUnit={setDepU} />
        <label><span>{t(`rebar.count.${memberType}`)}</span><input type="number" min="1" step="1" style={box} value={count} onChange={e => setCount(e.target.value)} /></label>
      </div>
      <small style={{display: 'block', color: 'var(--muted)', marginTop: '8px'}}>{t("rebar.dimNote")}</small>

      {sectionTitle(t("rebar.longitudinal"))}
      <div className="form-grid">
        {groupKeys.map(k => <label key={k}><span>{t(`rebar.group.${k}`)}</span><input type="number" min="0" step="1" style={box} value={groups[k]} onChange={e => setGroups({ ...groups, [k]: e.target.value })} /><small style={{color: 'var(--muted)'}}>{t("rebar.fromDrawing")}</small></label>)}
        <label><span>{t("rebar.diameter")}</span><input style={box} value={diameter} onChange={e => setDiameter(e.target.value)} placeholder={t("rebar.diameterPh")} /></label>
        <label><span>{t("rebar.stockLength")} (ft)</span><input type="number" min="0" step="any" style={box} value={stock} onChange={e => setStock(e.target.value)} /></label>
        <label><span>{t("rebar.lapLength")} (ft)</span><input type="number" min="0" step="any" style={box} value={lap} onChange={e => setLap(e.target.value)} /><small style={{color: 'var(--muted)'}}>{t("rebar.lapNote")}</small></label>
      </div>
      <div className="mix-display"><span>{t("rebar.effectiveAdditional")}</span><strong>{effectivePreview} ft</strong><small>{t("rebar.stockLength")} − {t("rebar.lapLength")}</small></div>

      {sectionTitle(t("rebar.stirrups"))}
      <label style={{display: 'flex', alignItems: 'center', gap: '10px', minHeight: '44px', cursor: 'pointer'}}><input type="checkbox" checked={stirOn} onChange={e => setStirOn(e.target.checked)} style={{width: '20px', height: '20px'}} />{t("rebar.includeStirrups")}</label>
      {stirOn && <div className="form-grid" style={{marginTop: '8px'}}>
        <label><span>{t("rebar.stirrupSize")}</span><select style={box} value={sizeChoice} onChange={e => setSizeChoice(e.target.value)}>
          <option value="standard">{STIRRUP_STANDARD_SIZE}</option>
          <option value="other">{t("rebar.stirrupOther")}</option>
        </select>{sizeChoice === "other" && <input style={{...box, marginTop: '8px'}} value={sizeOther} onChange={e => setSizeOther(e.target.value)} placeholder={t("rebar.diameterPh")} />}<small style={{color: 'var(--muted)'}}>{t("rebar.stirrupSizeNote")}</small></label>
        <LengthField t={t} label={t("rebar.spacing")} help={t("rebar.spacingHelp")} value={spacingV} unit={spacingU} units={["in", "mm", "cm", "ft"]} onValue={setSpacingV} onUnit={setSpacingU} />
        <label><span>{t("rebar.convention")}</span><select style={box} value={conv} onChange={e => setConv(e.target.value as StirrupConvention)}>
          <option value="both-ends">{t("rebar.conv.both")}</option>
          <option value="spaces-only">{t("rebar.conv.spaces")}</option>
        </select><small style={{color: 'var(--muted)'}}>{t("rebar.conventionNote")}</small></label>
        <LengthField t={t} label={t("rebar.cutLength")} help={t("rebar.cutHelp")} value={cutV} unit={cutU} units={["ft", "in", "mm", "cm", "m"]} onValue={setCutV} onUnit={setCutU} requireUnitChoice={false} />
      </div>}

      <button className="btn btn-primary btn-lg" onClick={handleCalculate} style={{width: '100%', marginTop: '20px'}}><Calculator size={18} />{t("rebar.calculate")}</button>
    </div>

    {c && r && <div style={{marginTop: '28px'}}>
      <div style={{background: 'var(--surface)', borderRadius: '8px', padding: '16px', marginBottom: '20px'}}>
        <h3 style={{marginBottom: '8px', fontSize: '15px', fontWeight: 600}}>{t("rebar.estimate").toUpperCase()}</h3>
        {sectionTitle(t("rebar.longitudinal"))}
        <Row k={t("rebar.requiredRun")} v={`${fmtNum(r.memberLengthFt)} ft`} />
        <Row k={t("rebar.stockLength")} v={`${fmtNum(c.stockBarLengthFt)} ft`} />
        <Row k={t("rebar.lapLength")} v={`${fmtNum(c.lapLengthFt)} ft`} />
        <Row k={t("rebar.effectiveAdditional")} v={`${fmtNum(r.effectiveAdditionalLengthFt)} ft`} />
        <Row k={t("rebar.barsPerRun")} v={String(r.barsPerRun)} />
        <Row k={t("rebar.laps")} v={String(r.lapsPerRun)} />
        <Row k={t("rebar.runs")} v={String(r.totalRuns)} />
        <Row k={t("rebar.totalBars")} v={String(r.totalStockBars)} />
        <Row k={t("rebar.totalPurchased")} v={`${fmtNum(r.totalPurchasedFt)} ft`} />
        <Row k={t("rebar.totalLap")} v={`${fmtNum(r.totalLapLengthFt)} ft`} />
        <Row k={t("rebar.excess")} v={`${fmtNum(r.excessPerRunFt)} ft × ${r.totalRuns} = ${fmtNum(r.totalExcessFt)} ft`} />
        <small style={{display: 'block', marginTop: '8px', color: 'var(--muted)'}}>{t("rebar.excessNote")}</small>
        {c.stirrup && r.stirrups && <>
          {sectionTitle(t("rebar.stirrups"))}
          <Row k={t("rebar.stirrupSize")} v={c.stirrup.size} />
          <Row k={t("rebar.spacing")} v={`${fmtNum(c.stirrup.spacing.value)} ${c.stirrup.spacing.unit}`} />
          <Row k={t("rebar.stirrupCount")} v={String(r.stirrups.total)} />
          <Row k={t("rebar.cutLength")} v={`${fmtNum(c.stirrup.cutLength.value)} ${c.stirrup.cutLength.unit}`} />
          <Row k={t("rebar.totalStirrup")} v={`${fmtNum(r.stirrups.totalLengthFt)} ft`} />
          <Row k={t("rebar.stirrupBars")} v={String(r.stirrups.stockBars)} />
        </>}
      </div>
      <BarLapDiagram bars={r.barsPerRun} stock={c.stockBarLengthFt} lap={c.lapLengthFt} required={r.memberLengthFt} vertical={memberType === "column"} t={t} />
      <div style={{background: 'var(--surface)', borderRadius: '8px', padding: '16px', marginBottom: '20px'}}>
        <h3 style={{marginBottom: '16px', fontSize: '14px', fontWeight: 600}}>{t("rebar.process").toUpperCase()}</h3>
        <div style={{fontSize: '12px', color: 'var(--muted)', display: 'grid', gap: '12px', overflowWrap: 'anywhere'}}>
          {steps.map(([title, lines]) => <div key={title}><div style={{fontWeight: 600, marginBottom: '4px', color: 'var(--text)'}}>{title}</div>{lines.map(l => <div key={l}>{l}</div>)}</div>)}
        </div>
      </div>
      <button className="btn btn-primary" style={{width: '100%'}} onClick={() => onSave(c)}><Save size={17} />{initial ? t("rebar.saveChanges") : t("rebar.save")}</button>
    </div>}
  </div>;
}

function staircaseReportRows(s: StaircaseCalculation, t: (key: string) => string): [string, string][] {
  const r = s.results;
  return [
    [t("stair.numberOfTreads"), String(s.numberOfTreads)],
    [t("stair.numberOfRisers"), String(s.numberOfRisers)],
    [t("stair.slopeLength"), formatFeet(r.slopeLengthFt)],
    [t("stair.waistSlab"), formatCubicFeet(r.waistSlabVolumeFt3)],
    [t("stair.steps"), formatCubicFeet(r.stepVolumeFt3)],
    [t("stair.landings"), formatCubicFeet(r.landingVolumeFt3)],
    [t("stair.totalConcrete"), formatCubicFeet(r.totalConcreteFt3)],
  ];
}

// Staircase concrete is kept out of the cement/sand/aggregate totals, so it gets its own combined row.
function stairConcreteTotal(concrete: CementWorksCalculation[], label: string) {
  const stairs = concrete.filter(c => c.category === "staircase");
  return stairs.length ? sumQuantities(stairs.map(c => c.results), ["Total Concrete"]).map(row => ({ ...row, label })) : [];
}

function ResultRows({ results, mixRatio, format }: { results?: QuantityResult[]; mixRatio?: string; format?: (value: string) => string }) {
  const { t, tl, tv: translateValue } = useApp();
  const tv = format ?? translateValue;
  const row = (k: string, v: string, i: number | string) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "12px" }}><span style={{ color: "var(--muted)" }}>{k}</span><strong style={{ textAlign: "right" }}>{v}</strong></div>;
  return <div style={{ display: "grid", gap: "6px" }}>
    {mixRatio && row(t("common.mixRatio"), tv(mixRatio), "mix")}
    {(results || []).filter(r => r.label || r.value).map((r, i) => r.value === "" ? <div key={i} style={{ fontSize: "12px", fontWeight: 600, marginTop: "6px" }}>{tl(r.label)}</div> : row(tl(r.label), tv(r.value), i))}
  </div>;
}

// Category text (name, heading, placeholder) by stable id; summary rows are translated by their English label.
const catText = (t: Translate, id: string, field: string) => t(`cat.${id}.${field}`);
const localizeRows = (rows: [string, string][], tl: (s: string) => string, tv: (s: string) => string) => rows.map(([k, v]) => [tl(k), tv(v)] as [string, string]);

function CementWorksCalculator({ only }: { only?: string[] }) {
  const { project, setProject, notify, t, tl, tv } = useApp();
  const q = useQuantityText();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const concrete: CementWorksCalculation[] = project.cementWorksCalculations || [];
  const rebarCalcs: ReinforcementCalculation[] = project.reinforcementCalculations || [];
  const editRebarId = searchParams.get("rebar");
  const editId = searchParams.get("edit");
  const fromReport = searchParams.get("from") === "report";
  const single = only?.length === 1 ? only[0] : null;
  const countIn = (id: string) => concrete.filter(c => c.category === id).length + rebarCalcs.filter(r => r.memberType === id).length;
  const startRebar = editRebarId ? rebarCalcs.find(s => s.id === editRebarId) ?? null : null;
  const startConcrete = editId ? concrete.find(c => c.id === editId) ?? null : null;

  const [selectedCategory, setSelectedCategory] = useState<string | null>(startRebar?.memberType ?? startConcrete?.category ?? single);
  const [screen, setScreen] = useState<"list" | "add">(startRebar || startConcrete || (single && countIn(single) === 0) ? "add" : "list");
  const [mode, setMode] = useState<"concrete" | "rebar" | null>(startRebar ? "rebar" : startConcrete ? "concrete" : null);
  const [editingConcrete, setEditingConcrete] = useState<CementWorksCalculation | null>(startConcrete);
  const [rebarEditing, setRebarEditing] = useState<ReinforcementCalculation | null>(startRebar);
  const config = getCategoryConfig(selectedCategory);

  const resetEditing = () => { setMode(null); setEditingConcrete(null); setRebarEditing(null); };
  const clearParams = () => { if (searchParams.toString()) setSearchParams({}); };
  // Leaves the add/edit screens without saving.
  const closeAdd = () => {
    resetEditing();
    if (fromReport) { nav("/report"); return; }
    clearParams();
    if (selectedCategory && (single || countIn(selectedCategory) > 0)) setScreen("list");
    else setSelectedCategory(null);
  };
  const afterSave = () => { resetEditing(); if (fromReport) { nav("/report"); return; } clearParams(); setScreen("list"); };
  const openCategory = (id: string) => { resetEditing(); setSelectedCategory(id); setScreen(countIn(id) > 0 ? "list" : "add"); };

  const saveConcrete = (calc: CementWorksCalculation) => {
    const existing = concrete.find(c => c.id === calc.id);
    // Editing keeps the record's id, creation time and work status.
    const stamped = stampRecord({ ...calc, workStatus: existing?.workStatus ?? calc.workStatus ?? "ongoing" }, existing);
    setProject({ ...project, cementWorksCalculations: upsertById(concrete, stamped) });
    notify(t(existing ? "common.calculationUpdated" : "common.calculationSaved"));
    afterSave();
  };
  const saveRebar = (calc: ReinforcementCalculation) => {
    const existing = rebarCalcs.find(s => s.id === calc.id);
    const exists = !!existing;
    const stamped = stampRecord({ ...calc, workStatus: existing?.workStatus ?? calc.workStatus ?? "ongoing" }, existing);
    setProject({ ...project, reinforcementCalculations: upsertById(rebarCalcs, stamped) });
    notify(t(exists ? "rebar.updated" : "rebar.saved"));
    afterSave();
  };
  const updateConcrete = (list: CementWorksCalculation[], messageKey: string) => { setProject({ ...project, cementWorksCalculations: list }); notify(t(messageKey)); };
  const updateRebarList = (list: ReinforcementCalculation[], message: string) => { setProject({ ...project, reinforcementCalculations: list }); notify(t(message)); };

  if (config && screen === "add") {
    const member = config.member;
    if (member && mode === "rebar") {
      return <ReinforcementCalculator key={rebarEditing?.id ?? config.id} memberType={member} initial={rebarEditing}
        concreteOptions={concrete.filter(cw => cw.category === config.id)}
        onSave={saveRebar} onBack={() => rebarEditing ? closeAdd() : setMode(null)} />;
    }
    if (member && mode === null) {
      const cards: [string, string, string][] = [["concrete", t("rebar.concreteQty"), t("rebar.concreteQtyDesc")], ["rebar", t("rebar.steelQty"), t("rebar.steelQtyDesc")]];
      return <div className="content-wrap">
        <button className="back-link" onClick={closeAdd}><ArrowLeft size={16} aria-hidden="true" /> {t("back")}</button>
        <div className="content-heading"><span className="eyebrow"><span />{t(`rebar.member.${member}`).toUpperCase()}</span><h2>{t("rebar.chooseType")}</h2></div>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginTop: '24px'}}>
          {cards.map(([id, title, desc]) => <button key={id} onClick={() => { setRebarEditing(null); setEditingConcrete(null); setMode(id as "concrete" | "rebar"); }} style={{padding: '24px', minHeight: '44px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', cursor: 'pointer', textAlign: 'left', color: 'inherit'}}>
            <h3 style={{margin: '0 0 6px', fontSize: '18px'}}>{title}</h3>
            <p style={{margin: 0, color: 'var(--muted)', fontSize: '13px'}}>{desc}</p>
          </button>)}
        </div>
      </div>;
    }
    if (config.id === "staircase") {
      return <StaircaseCalculator key={editingConcrete?.id ?? "new"} initial={editingConcrete} t={t}
        defaultName={defaultCalcName(catText(t, config.id, "singular"), concrete.filter(c => c.category === config.id).length)}
        onSave={saveConcrete} onBack={closeAdd} />;
    }
    return <CementCalculatorForm key={editingConcrete?.id ?? "new"} config={config} initial={editingConcrete}
      defaultName={defaultCalcName(catText(t, config.id, "singular"), concrete.filter(c => c.category === config.id).length)}
      onSave={saveConcrete} onBack={() => member && !editingConcrete ? setMode(null) : closeAdd()} />;
  }

  if (config) {
    const member = config.member;
    const title = catText(t, config.id, "label");
    const singular = catText(t, config.id, "singular");
    const catConcrete = concrete.filter(c => c.category === config.id);
    const catRebar = member ? rebarCalcs.filter(r => r.memberType === member) : [];
    const concreteItems: SavedItem[] = catConcrete.map(c => {
      const linked = rebarCalcs.filter(r => r.linkedConcreteId === c.id);
      return {
        id: c.id,
        title: c.name,
        workStatus: c.workStatus ?? "ongoing",
        rows: [...localizeRows(cementSummaryRows(config, c), tl, config.volumeOutput ? v => q(v, outputUnitOf(c)) : tv), ...(member ? [[t("rebar.short"), linked.length ? linked.map(r => r.calculationName).join(", ") : "—"] as [string, string]] : [])],
        details: c.staircase ? <StaircaseSummary calc={c.staircase} t={t} /> : <ResultRows results={c.results} mixRatio={c.mixRatio} format={config.volumeOutput ? v => q(v, outputUnitOf(c)) : undefined} />,
      };
    });
    const rebarItems: SavedItem[] = catRebar.map(rc => ({
      id: rc.id,
      title: rc.calculationName,
      badge: t("rebar.short"),
      workStatus: rc.workStatus ?? "ongoing",
      rows: [
        [t(`rebar.count.${rc.memberType}`), String(rc.memberCount)],
        [t("rebar.mainBarSize"), rc.mainBarDiameter || "—"],
        [t("rebar.totalBars"), `${rc.results.totalStockBars} × ${fmtNum(rc.stockBarLengthFt)} ft`],
        [t("rebar.stirrupCount"), rc.results.stirrups ? String(rc.results.stirrups.total) : t("rebar.notIncluded")],
        [t("rebar.concreteEstimate"), concrete.find(c => c.id === rc.linkedConcreteId)?.name ?? t("rebar.noLink")],
      ],
      details: <ReinforcementSummary calc={rc} />,
    }));
    const hasSaved = catConcrete.length + catRebar.length > 0;
    return <div className="content-wrap">
      {!single && <button className="back-link" onClick={() => setSelectedCategory(null)}><ArrowLeft size={16} aria-hidden="true" /> {t("back")}</button>}
      <div className="content-heading"><span className="eyebrow"><span />{t("cement-works").toUpperCase()} › {title.toUpperCase()}</span><h2>{title}</h2><p>{t("cw.listText")}</p></div>
      <SavedCalculationList heading={t("cw.savedHeading", { what: singular })} items={concreteItems} labels={listLabels(t)}
        totals={localizeTotals(sumQuantities(catConcrete.map(c => c.results), config.totalLabels), tl).map(r => (config.volumeOutput ? { ...r, value: q(r.value) } : r))}
        addLabel={t(hasSaved ? "cw.addAnother" : "cw.add", { what: singular })} emptyText={t("cw.empty", { what: singular })}
        onAdd={() => { resetEditing(); setScreen("add"); }}
        onEdit={id => { const c = concrete.find(x => x.id === id); if (c) { setEditingConcrete(c); setMode(member ? "concrete" : null); setScreen("add"); } }}
        onDuplicate={id => updateConcrete(duplicateById(concrete, id, c => stampRecord({ ...c, name: `${c.name} (${t("copy")})`, createdAt: undefined })), "common.calculationDuplicated")}
        onDelete={id => updateConcrete(removeById(concrete, id), "common.calculationDeleted")}
        onToggleStatus={id => updateConcrete(toggleWorkStatus(concrete, id), "status.updated")} />
      {rebarItems.length > 0 && <SavedCalculationList heading={t("cw.savedRebarHeading", { what: singular })} items={rebarItems} labels={listLabels(t)}
        totals={sumReinforcement(catRebar, t)} confirmDelete={() => t("rebar.confirmDelete")}
        onEdit={id => { const rc = rebarCalcs.find(x => x.id === id); if (rc) { setRebarEditing(rc); setMode("rebar"); setScreen("add"); } }}
        onDuplicate={id => updateRebarList(duplicateById(rebarCalcs, id, rc => stampRecord({ ...rc, calculationName: `${rc.calculationName} (${t("copy")})`, createdAt: undefined })), "rebar.duplicated")}
        onDelete={id => updateRebarList(removeById(rebarCalcs, id), "rebar.deleted")}
        onToggleStatus={id => updateRebarList(toggleWorkStatus(rebarCalcs, id), "status.updated")}
        extraActions={id => <button type="button" style={actionButtonStyle} onClick={() => updateRebarList(rebarCalcs.map(rc => rc.id === id ? { ...rc, results: calculateReinforcement(rc) } : rc), "rebar.recalculated")}>{t("recalculate")}</button>} />}
    </div>;
  }

  const visible = CATEGORY_CONFIGS.filter(c => !only || only.includes(c.id));
  const visibleConcrete = concrete.filter(c => visible.some(v => v.id === c.category));
  return <div className="content-wrap">
    <div className="content-heading"><h2>{t("cw.chooseTitle")}</h2><p>{t("cw.chooseText")}</p></div>
    <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginTop: '24px'}}>
      {visible.map(cat => <button key={cat.id} onClick={() => openCategory(cat.id)} style={{padding: '24px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s', textDecoration: 'none', color: 'inherit'}}>
        <div style={{fontSize: '32px', marginBottom: '8px'}}>{cat.icon}</div>
        <h3 style={{margin: '0 0 4px', fontSize: '18px', fontWeight: '600'}}>{catText(t, cat.id, "label")}</h3>
        <p style={{margin: '0', color: 'var(--muted)', fontSize: '13px'}}>{catText(t, cat.id, "description")}</p>
        {countIn(cat.id) > 0 && <small style={{display: 'block', marginTop: '8px', color: 'var(--green)', fontWeight: 600}}>{t("cw.savedCount", { count: countIn(cat.id) })}</small>}
      </button>)}
    </div>
    {visibleConcrete.length > 1 && <TotalsPanel title={t("cw.combinedTotals")} totals={[...localizeTotals(sumQuantities(visibleConcrete.map(c => c.results), TOTAL_LABELS.cementWorks), tl), ...stairConcreteTotal(visibleConcrete, t("stair.combinedTotal"))]} count={visibleConcrete.length} />}
  </div>;
}


// Older brickwork screens stored "inches"/"foot"; every length goes through the shared units module.
const convertToMetres = (value: number, unit: string) => lengthToMetres(value, toLengthUnit(unit) ?? "m");

type BrickworkRun = { results: QuantityResult[]; breakdown: NonNullable<ReturnType<typeof computeBrickworkBreakdown>>; totalOpeningM2: number };
// Errors are returned as translation keys so they follow the selected language.
function runBrickwork(a: {
  categoryId: string; thicknessId: string; isBlock: boolean;
  values: { wallLength: number; wallHeight: number; wallCount: number; wastagePercent: number };
  units: { wallLength: string; wallHeight: string };
  openings: WallOpening[];
  wallWidth: { value: number; unit: LengthUnit } | null;
  unitMm: { length: number; width: number; height: number };
}): BrickworkRun | { error: string } {
  const thickness = BRICKWORK_CATEGORIES.find(c => c.id === a.categoryId)?.thicknesses.find(t => t.id === a.thicknessId);
  const wallLengthM = convertToMetres(a.values.wallLength, a.units.wallLength);
  const wallHeightM = convertToMetres(a.values.wallHeight, a.units.wallHeight);
  if (![wallLengthM, wallHeightM].every(v => Number.isFinite(v) && v > 0)) return { error: "bw.err.wallSize" };
  if (!Number.isInteger(a.values.wallCount) || a.values.wallCount <= 0) return { error: "bw.err.wallCount" };
  if (a.openings.some(o => !Number.isFinite(o.width) || !Number.isFinite(o.height) || o.width <= 0 || o.height <= 0 || !ALL_LENGTH_UNITS.includes(o.unit))) return { error: "bw.err.openingSize" };
  const totalOpeningM2 = totalOpeningAreaSquareMetres(a.openings);
  if (totalOpeningM2 > wallLengthM * wallHeightM * a.values.wallCount) return { error: "bw.err.openingExceeds" };
  if (!Number.isFinite(a.values.wastagePercent) || a.values.wastagePercent < 0) return { error: "bw.err.wastage" };

  // Cement block walls use the width the user typed; brick walls use the selected standard thickness.
  let wallWidthM: number;
  if (a.isBlock) {
    if (!a.wallWidth || !Number.isFinite(a.wallWidth.value) || a.wallWidth.value <= 0 || !ALL_LENGTH_UNITS.includes(a.wallWidth.unit)) return { error: "bw.err.wallWidth" };
    wallWidthM = lengthToMetres(a.wallWidth.value, a.wallWidth.unit);
  } else {
    if (!thickness) return { error: "bw.err.selectCategory" };
    wallWidthM = convertToMetres(parseFloat(thickness.inches), "in");
  }

  const input = {
    categoryId: a.categoryId,
    thicknessId: a.thicknessId,
    wallLength: wallLengthM,
    wallHeight: wallHeightM,
    wallCount: a.values.wallCount,
    openingArea: totalOpeningM2,
    wastagePercent: a.values.wastagePercent,
    wallWidth: wallWidthM,
    brickLength: a.unitMm.length / 1000,
    brickWidth: a.unitMm.width / 1000,
    brickHeight: a.unitMm.height / 1000,
    unitName: a.isBlock ? "Cement Blocks" : "Bricks",
    wallWidthNote: a.isBlock ? "Entered wall width" : "Selected thickness",
  };
  const breakdown = computeBrickworkBreakdown(input);
  if (!breakdown) return { error: "bw.err.category" };
  return { results: calculateBrickwork(input), breakdown, totalOpeningM2 };
}

const OPENING_TYPES: OpeningType[] = ["door", "window", "other"];

// Any number of door/window openings, each with its own unit; their areas are deducted from the wall.
function OpeningsEditor({ openings, onChange }: { openings: WallOpening[]; onChange: (openings: WallOpening[]) => void }) {
  const { t } = useApp();
  const box = { padding: '8px', minHeight: '44px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', minWidth: 0 } as const;
  const patch = (id: string, change: Partial<WallOpening>) => onChange(openings.map(o => (o.id === id ? { ...o, ...change } : o)));
  const add = () => onChange([...openings, { id: makeId(), type: openings.length ? "window" : "door", width: 0, height: 0, unit: openings[openings.length - 1]?.unit ?? "ft" }]);
  const total = totalOpeningAreaSquareMetres(openings.filter(o => o.width > 0 && o.height > 0));
  return <div style={{ display: "grid", gap: "10px" }}>
    <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>{t("opening.title")}</p>
    {!openings.length && <small style={{ color: 'var(--muted)' }}>{t("opening.none")}</small>}
    {openings.map((o, i) => <div key={o.id} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-end", padding: "10px", border: "1px solid var(--border)", borderRadius: "8px" }}>
      <label style={{ flex: "1 1 120px" }}><span style={{ fontSize: "12px" }}>{t("opening.n", { n: i + 1 })}</span>
        <select value={o.type} onChange={e => patch(o.id, { type: e.target.value as OpeningType })} style={{ ...box, width: "100%" }}>{OPENING_TYPES.map(type => <option key={type} value={type}>{t(`opening.${type}`)}</option>)}</select></label>
      <label style={{ flex: "1 1 120px" }}><span style={{ fontSize: "12px" }}>{t("opening.name")}</span>
        <input value={o.name ?? ""} maxLength={60} placeholder={t(`opening.${o.type}`)} onChange={e => patch(o.id, { name: e.target.value })} style={{ ...box, width: "100%" }} /></label>
      <label style={{ flex: "1 1 90px" }}><span style={{ fontSize: "12px" }}>{t("opening.width")}</span>
        <input type="number" min="0" step="any" value={o.width || ""} onChange={e => patch(o.id, { width: Number(e.target.value) })} style={{ ...box, width: "100%" }} /></label>
      <label style={{ flex: "1 1 90px" }}><span style={{ fontSize: "12px" }}>{t("opening.height")}</span>
        <input type="number" min="0" step="any" value={o.height || ""} onChange={e => patch(o.id, { height: Number(e.target.value) })} style={{ ...box, width: "100%" }} /></label>
      <label style={{ flex: "1 1 110px" }}><span style={{ fontSize: "12px" }}>{t("common.unit")}</span>
        <select value={o.unit} onChange={e => patch(o.id, { unit: e.target.value as LengthUnit })} style={{ ...box, width: "100%" }}>{ALL_LENGTH_UNITS.map(u => <option key={u} value={u}>{t(`unit.${u}`)} ({u})</option>)}</select></label>
      <small style={{ flex: "1 1 100px", color: "var(--muted)", paddingBottom: "12px" }}>{o.width > 0 && o.height > 0 ? `${fmtNum(openingAreaSquareMetres(o), 3)} m²` : "—"}</small>
      <button type="button" aria-label={`${t("opening.remove")} ${i + 1}`} title={t("opening.remove")} onClick={() => onChange(openings.filter(x => x.id !== o.id))} style={{ ...box, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}><Trash2 size={16} aria-hidden="true" />{t("opening.remove")}</button>
    </div>)}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
      <button type="button" className="btn btn-secondary" onClick={add}><Plus size={16} />{t("opening.add")}</button>
      <strong style={{ fontSize: "13px" }}>{t("label.Total Opening Area")}: {fmtNum(total, 3)} m²</strong>
    </div>
  </div>;
}

function BrickworkWizard({ initial, existingCount, onSave, onCancel }: { initial: BrickworkCalculation | null; existingCount: number; onSave: (calc: BrickworkCalculation) => void; onCancel: () => void }) {
  const { notify, t, tl, tn, tv } = useApp();
  const q = useQuantityText();
  const initialType = initial ? initial.wallType ?? "brick" : null;
  const initialDims = initial?.unitDimensions;
  const savedBrick = initialType === "brick" ? initialDims : undefined;
  const savedBlock = initialType === "cement-block" ? initialDims : undefined;
  const initialCategory = initial ? BRICKWORK_CATEGORIES.find(c => c.id === initial.categoryId) : undefined;
  // A saved thickness that no longer exists (e.g. the removed 13½ inch option) must be chosen again.
  const initialThickness = initial && (initial.wallType === "cement-block" || initialCategory?.thicknesses.some(th => th.id === initial.thicknessId)) ? initial.thicknessId : null;
  const [wallType, setWallType] = useState<"brick" | "cement-block" | null>(initialType);
  const [useStandardSize, setUseStandardSize] = useState(initialDims?.useStandardSize ?? true);
  const [dimensionsConfirmed, setDimensionsConfirmed] = useState(!!initial);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(initial?.categoryId ?? null);
  const [selectedThickness, setSelectedThickness] = useState<string | null>(initialThickness);

  // Brick dimensions (default: 205×95×75 mm)
  const [brickLength, setBrickLength] = useState(savedBrick?.lengthMm ?? 205);
  const [brickWidth, setBrickWidth] = useState(savedBrick?.widthMm ?? 95);
  const [brickHeight, setBrickHeight] = useState(savedBrick?.heightMm ?? 75);

  // Cement block dimensions (default: 400×200×100 mm)
  const [blockLength, setBlockLength] = useState(savedBlock?.lengthMm ?? 400);
  const [blockHeight, setBlockHeight] = useState(savedBlock?.heightMm ?? 200);
  const [blockWidth, setBlockWidth] = useState(savedBlock?.widthMm ?? 100);

  const [values, setValues] = useState({ wallLength: initial?.wallLength ?? 10, wallHeight: initial?.wallHeight ?? 3, wallCount: initial?.wallCount ?? 1, wastagePercent: initial?.wastagePercent ?? 5 });
  const [units, setUnits] = useState({ wallLength: initial?.units?.wallLength ?? "m", wallHeight: initial?.units?.wallHeight ?? "m" });
  const [openings, setOpenings] = useState<WallOpening[]>(initial?.openings ?? []);
  // Older cement block records chose a fixed thickness; that thickness becomes the starting wall width.
  const legacyBlockInches = initial?.wallType === "cement-block" ? initialCategory?.thicknesses.find(th => th.id === initial.thicknessId)?.inches : undefined;
  const [wallWidth, setWallWidth] = useState<{ value: number; unit: LengthUnit }>(initial?.wallWidth ?? (legacyBlockInches ? { value: Number(legacyBlockInches), unit: "in" } : { value: 100, unit: "mm" }));
  const [outputUnit, setOutputUnit] = useState<VolumeUnit>(outputUnitOf(initial));
  const [calcName, setCalcName] = useState(initial?.name ?? "");

  const isBlock = wallType === "cement-block";
  const unitMm = isBlock
    ? (useStandardSize ? { length: 400, width: 100, height: 200 } : { length: blockLength, width: blockWidth, height: blockHeight })
    : (useStandardSize ? { length: 205, width: 95, height: 75 } : { length: brickLength, width: brickWidth, height: brickHeight });
  // Results are only shown while they match the current inputs, so Save can never store stale numbers.
  const calcKey = JSON.stringify([wallType, unitMm, selectedCategory, selectedThickness, values, units, openings, isBlock ? wallWidth : null]);
  const runNow = () => runBrickwork({ categoryId: selectedCategory!, thicknessId: selectedThickness!, isBlock, values, units, openings, wallWidth: isBlock ? wallWidth : null, unitMm });
  const [run, setRun] = useState<(BrickworkRun & { key: string }) | null>(() => {
    if (!initial || !selectedCategory || !selectedThickness) return null;
    const r = runNow();
    return "error" in r ? null : { ...r, key: calcKey };
  });
  const results = run && run.key === calcKey ? run.results : [];
  const breakdown = run && run.key === calcKey ? run.breakdown : null;
  const cancelLink = <button className="back-link" style={{ float: "right" }} onClick={onCancel}>{initial ? t("bw.cancelEditing") : t("common.cancel")}</button>;

  const category = selectedCategory ? BRICKWORK_CATEGORIES.find(c => c.id === selectedCategory) : null;
  const thickness = selectedThickness && category ? category.thicknesses.find(t => t.id === selectedThickness) : null;
  const wallTypeLabel = t(isBlock ? "cement-block-wall" : "brick-wall");
  const box = { padding: '8px', minHeight: '44px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', width: '100%' } as const;
  const mmField = (labelKey: string, value: number, set: (n: number) => void) => <label><span>{t(labelKey)} (mm)</span><input type="number" value={value} onChange={(e) => set(Number(e.target.value))} style={box} /></label>;

  // Show wall type selection first
  if (!wallType) {
    const card = (type: "brick" | "cement-block", icon: string, size: string) => <button onClick={() => setWallType(type)} style={{padding: '24px', background: 'var(--card)', border: '2px solid var(--border)', borderRadius: '12px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s', fontSize: '16px', color: 'inherit'}}>
      <div style={{fontSize: '32px', marginBottom: '12px'}}>{icon}</div>
      <h3 style={{margin: '0 0 8px', fontSize: '18px'}}>{t(type === "brick" ? "brick-wall" : "cement-block-wall")}</h3>
      <p style={{margin: '0 0 12px', color: 'var(--muted)', fontSize: '13px'}}>{t("bw.standardUnitSize")}<br /><strong>{size}</strong></p>
      <small style={{color: 'var(--subtle)'}}>{t("bw.customSupported")}</small>
    </button>;
    return <div className="content-wrap">
      {cancelLink}
      <div className="content-heading"><span className="eyebrow"><span />{t("bw.eyebrow")}</span><h2>{t("bw.chooseWallType")}</h2><p>{t("bw.chooseWallTypeText")}</p></div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginTop: '24px'}}>
        {card("brick", "▦", "205 × 95 × 75 mm")}
        {card("cement-block", "▤", "400 × 200 × 100 mm")}
      </div>
    </div>;
  }

  // Show dimension selection for the chosen wall type
  if (!dimensionsConfirmed) {
    return <div className="content-wrap">
      {cancelLink}
      <button className="back-link" onClick={() => setWallType(null)}><ArrowLeft size={16} aria-hidden="true" /> {t("bw.changeWallType")}</button>
      <div className="content-heading"><h2>{t(isBlock ? "block-dimensions" : "brick-dimensions")}</h2></div>
      <div style={{marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid var(--border)'}}>
        <label style={{display: 'flex', alignItems: 'center', marginBottom: '16px', cursor: 'pointer', minHeight: '44px'}}>
          <input type="radio" checked={useStandardSize} onChange={() => setUseStandardSize(true)} style={{marginRight: '8px'}} />
          <span>{t("standard-size")}</span>
        </label>
        {useStandardSize && <div style={{paddingLeft: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border)', marginBottom: '16px'}}>
          <small style={{display: 'block', color: 'var(--muted)'}}>{t(isBlock ? "bw.standardBlockSize" : "bw.standardBrickSize")}</small>
          <strong>{isBlock ? "400 × 200 × 100 mm" : "205 × 95 × 75 mm"}</strong>
        </div>}
        <label style={{display: 'flex', alignItems: 'center', marginBottom: '16px', cursor: 'pointer', minHeight: '44px'}}>
          <input type="radio" checked={!useStandardSize} onChange={() => setUseStandardSize(false)} style={{marginRight: '8px'}} />
          <span>{t("custom-size")}</span>
        </label>
      </div>
      {!useStandardSize && <div className="form-grid" style={{marginBottom: '16px'}}>
        {!isBlock ? <>
          {mmField("brick-length", brickLength, setBrickLength)}
          {mmField("brick-width", brickWidth, setBrickWidth)}
          {mmField("brick-height", brickHeight, setBrickHeight)}
          <button onClick={() => { setBrickLength(205); setBrickWidth(95); setBrickHeight(75); }} style={{gridColumn: '1 / -1', padding: '10px', minHeight: '44px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text)'}}>{t("reset-standard")}</button>
        </> : <>
          {mmField("block-length", blockLength, setBlockLength)}
          {mmField("block-height", blockHeight, setBlockHeight)}
          {mmField("block-width", blockWidth, setBlockWidth)}
          <button onClick={() => { setBlockLength(400); setBlockHeight(200); setBlockWidth(100); }} style={{gridColumn: '1 / -1', padding: '10px', minHeight: '44px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text)'}}>{t("bw.resetStandardBlock")}</button>
        </>}
      </div>}
      <button className="btn btn-primary" onClick={() => {
        const dims = isBlock ? [blockLength, blockHeight, blockWidth] : [brickLength, brickWidth, brickHeight];
        if (dims.some(d => !Number.isFinite(d) || d <= 0)) { notify(t("bw.err.unitDims")); return; }
        setDimensionsConfirmed(true);
      }} style={{width: '100%', marginTop: '16px'}}>{t("common.continue")}<ArrowRight size={17} /></button>
    </div>;
  }

  const unitWordKey = isBlock ? "bw.block" : "bw.brick";
  const unitPluralKey = isBlock ? "bw.blocks" : "bw.bricks";

  const handleCalculate = () => {
    if (!selectedCategory || !selectedThickness) { notify(t("bw.err.selectCategory")); return; }
    const r = runNow();
    if ("error" in r) { notify(t(r.error)); return; }
    setRun({ ...r, key: calcKey });
  };

  const handleSave = () => {
    if (!results.length || !run) return;
    onSave(stampRecord<BrickworkCalculation>({
      id: initial?.id ?? makeId(),
      name: calcName.trim() || initial?.name || defaultCalcName(wallTypeLabel, existingCount),
      categoryId: selectedCategory!,
      thicknessId: selectedThickness!,
      wallLength: values.wallLength,
      wallHeight: values.wallHeight,
      wallCount: values.wallCount,
      // Total of all openings in m², kept for older readers; the full list is in `openings`.
      openingArea: Number(run.totalOpeningM2.toFixed(4)),
      openings,
      wastagePercent: values.wastagePercent,
      units: { wallLength: units.wallLength, wallHeight: units.wallHeight, openingArea: "m²" },
      ...(isBlock ? { wallWidth } : {}),
      results,
      wallType: wallType || "brick",
      unitDimensions: { lengthMm: unitMm.length, widthMm: unitMm.width, heightMm: unitMm.height, useStandardSize },
      outputUnit,
      workStatus: initial?.workStatus ?? "ongoing",
    }, initial));
  };

  if (!selectedCategory) {
    return <div className="content-wrap">
      {cancelLink}
      <button className="back-link" onClick={() => setDimensionsConfirmed(false)}><ArrowLeft size={16} aria-hidden="true" /> {t(isBlock ? "bw.changeBlockDims" : "bw.changeBrickDims")}</button>
      <div className="content-heading"><span className="eyebrow"><span />{t("bw.eyebrow")}</span><h2>{t("bw.chooseMasonry")}</h2><p>{t("bw.chooseMasonryText")}</p></div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginTop: '24px'}}>
        {BRICKWORK_CATEGORIES.map((cat, i) => <button key={cat.id} onClick={() => { setSelectedCategory(cat.id); setSelectedThickness(isBlock ? "custom" : null); }} style={{padding: '20px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s', color: 'inherit'}}>
          <div style={{fontSize: '12px', color: 'var(--muted)', marginBottom: '8px'}}>{String(i + 1).padStart(2, "0")}</div>
          <h3 style={{margin: '0 0 8px', fontSize: '16px'}}>{tv(cat.name)}</h3>
          <p style={{margin: '0 0 12px', color: 'var(--muted)', fontSize: '13px'}}>{t("label.Mortar Ratio")}: <strong>{cat.mortarRatio}</strong></p>
          {!isBlock && <div style={{fontSize: '12px', color: 'var(--subtle)'}}>{cat.thicknesses.map(th => th.inches).join('" • ') + '"'}</div>}
        </button>)}
      </div>
    </div>;
  }

  // Brick walls choose one of the standard thicknesses; cement block walls type their width on the next screen.
  if (!selectedThickness) {
    return <div className="content-wrap">
      {cancelLink}
      <button className="back-link" onClick={() => setSelectedCategory(null)}><ArrowLeft size={16} aria-hidden="true" /> {t("bw.changeCategory")}</button>
      <div className="content-heading"><h2>{category ? tv(category.name) : ""}</h2><p>{t("label.Mortar Ratio")}: <strong>{category?.mortarRatio}</strong></p></div>
      <p style={{marginBottom: '20px', color: 'var(--muted)'}}>{t("bw.selectThickness")}</p>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px'}}>
        {category?.thicknesses.map(th => <button key={th.id} onClick={() => setSelectedThickness(th.id)} style={{padding: '16px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', cursor: 'pointer', textAlign: 'center', color: 'inherit'}}>
          <div style={{fontSize: '24px', fontWeight: 'bold', marginBottom: '8px'}}>{th.inches}"</div>
          <div style={{fontSize: '12px', color: 'var(--muted)'}}>{tl(th.label)}</div>
        </button>)}
      </div>
    </div>;
  }

  const b = breakdown;
  const f = (n: number, d = 3) => Number(n.toFixed(d)).toLocaleString();
  const step = (n: number, key: string, vars?: Record<string, string | number>) => `${t("common.stepN", { n })}: ${t(key, vars)}`;
  const widthText = isBlock ? `${wallWidth.value} ${wallWidth.unit}` : `${thickness?.inches}"`;
  const steps: [string, string[]][] = b ? [
    [step(1, "bw.step1"), [
      `${t("label.Wall Type")}: ${wallTypeLabel} · ${tv(b.category.name)}`,
      `${t("bw.wallLength")}: ${values.wallLength} ${units.wallLength} = ${f(b.wallLength)} m`,
      `${t("bw.wallHeight")}: ${values.wallHeight} ${units.wallHeight} = ${f(b.wallHeight)} m`,
      `${t("bw.wallCount")}: ${b.wallCount}`,
      `${t(isBlock ? "bw.wallWidth" : "bw.wallThickness")}: ${widthText} = ${f(b.wallWidth)} m`,
      `${t("bw.unitSize", { what: t(unitWordKey) })}: ${unitMm.length} × ${unitMm.width} × ${unitMm.height} mm`,
      ...openings.map((o, i) => `${t("opening.n", { n: i + 1 })} (${o.name || t(`opening.${o.type}`)}): ${o.width} × ${o.height} ${o.unit} = ${f(openingAreaSquareMetres(o))} m²`),
    ]],
    [step(2, "bw.step2"), [`${f(b.wallLength)} × ${f(b.wallHeight)} × ${b.wallCount} = ${f(b.grossArea)} m²`]],
    [step(3, "bw.step3"), [
      `${t("label.Total Opening Area")}: ${openings.length ? openings.map(o => f(openingAreaSquareMetres(o))).join(" + ") : "0"} = ${f(b.openingArea)} m²`,
      `${f(b.grossArea)} − ${f(b.openingArea)} = ${f(b.netArea)} m² (${t("label.Net Wall Area")})`,
    ]],
    [step(4, "bw.step4"), [`${f(b.netArea)} × (1 + ${b.wastage} ÷ 100) = ${f(b.effectiveArea)} m²`]],
    [step(5, "bw.step5"), [`${f(b.effectiveArea)} × ${f(b.wallWidth)} = ${f(b.wallVolume, 4)} m³`]],
    [step(6, "bw.step6", { what: t(unitWordKey) }), [`${f(b.brickLength)} × ${f(b.brickWidth)} × ${f(b.brickHeight)} = ${f(b.brickVolume, 6)} m³`]],
    [step(7, "bw.step7", { what: t(unitPluralKey) }), [`${f(b.wallVolume, 4)} ÷ ${f(b.brickVolume, 6)} = ${f(b.wallVolume / b.brickVolume, 2)} → ${b.brickQuantity.toLocaleString()} ${tv("nos.")} (${t("bw.roundedUp")})`]],
    [step(8, "bw.step8"), [
      `${t("bw.wet")}: ${f(b.effectiveArea)} × 0.02 = ${f(b.mortarVolume, 4)} m³ = ${q(`${b.mortarVolume} m³`, "cube")}`,
      `${t("bw.dry")}: ${f(b.mortarVolume, 4)} × 1.33 = ${f(b.dryMortarVolume, 4)} m³ = ${q(`${b.dryMortarVolume} m³`, "cube")}`,
    ]],
    [step(9, "bw.step9", { ratio: b.category.mortarRatio }), [
      `${f(b.mortarVolume, 4)} × ${b.ratios[0]} ÷ ${b.totalParts} = ${f(b.cementVolume, 4)} m³ = ${q(`${b.cementVolume} m³`, "cube")}`,
      `${f(b.cementVolume, 4)} m³ × 1.33 × 35.3147 = ${f(b.cementVolume * 1.33 * 35.3146667214886, 2)} ft³ → ${tv(`${b.cementBags} bags`)} (1 bag = 1 ft³)`,
    ]],
    [step(10, "bw.step10"), [`${f(b.mortarVolume, 4)} × ${b.ratios[1]} ÷ ${b.totalParts} = ${f(b.sandVolume, 4)} m³ = ${q(`${b.sandVolume} m³`, "cube")}`]],
  ] : [];

  return <div className="content-wrap">
    {cancelLink}
    <button className="back-link" onClick={() => isBlock ? setSelectedCategory(null) : setSelectedThickness(null)}><ArrowLeft size={16} aria-hidden="true" /> {t(isBlock ? "bw.changeCategory" : "bw.changeThickness")}</button>
    <div className="content-heading"><h2>{t("bw.calculatorTitle", { what: category ? tv(category.name) : "" })}</h2><p>{!isBlock && <>{t("bw.wallThickness")}: <strong>{thickness?.inches}"</strong> • </>}{t("label.Mortar Ratio")}: <strong>{category?.mortarRatio}</strong></p></div>
    <div className="calculator-panel">
      <div style={{marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid var(--border)'}}>
        <p style={{fontSize: '13px', color: 'var(--muted)', marginBottom: '8px'}}>{wallTypeLabel} · {t(isBlock ? "block-dimensions" : "brick-dimensions")} ({t(useStandardSize ? "bw.standard" : "bw.custom")})</p>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap'}}>
          <strong>{unitMm.length} × {unitMm.width} × {unitMm.height} mm <small style={{color: 'var(--muted)', fontWeight: 400}}>({t("bw.lwh")})</small></strong>
          <button className="btn btn-secondary" onClick={() => { setDimensionsConfirmed(false); setSelectedCategory(null); setSelectedThickness(null); setRun(null); }}>{t("bw.changeSize")}</button>
        </div>
      </div>
      {initial && !initial.units && <div className="assumption" style={{marginBottom: '16px'}}><Lightbulb /><span>{t("bw.legacyUnits")}</span></div>}
      <div>
        <p style={{fontSize: '13px', color: 'var(--muted)', marginBottom: '12px'}}>{t("bw.wallMeasurements")}</p>
        <div className="form-grid">
          <CalcFieldWithUnitSelect label={t("bw.wallLength")} value={values.wallLength} unit={units.wallLength} onChange={(v: number) => setValues({...values, wallLength: v})} onUnitChange={(u: string) => setUnits({...units, wallLength: u})} />
          <CalcFieldWithUnitSelect label={t("bw.wallHeight")} value={values.wallHeight} unit={units.wallHeight} onChange={(v: number) => setValues({...values, wallHeight: v})} onUnitChange={(u: string) => setUnits({...units, wallHeight: u})} />
          {isBlock && <CalcFieldWithUnitSelect label={t("bw.wallWidth")} value={wallWidth.value} unit={wallWidth.unit} onChange={(v: number) => setWallWidth({ ...wallWidth, value: v })} onUnitChange={(u: string) => setWallWidth({ ...wallWidth, unit: (toLengthUnit(u) ?? "mm") })} />}
          <CalcField label={t("bw.wallCount")} unit={t("bw.countUnit")} value={values.wallCount} onChange={(v: number) => setValues({...values, wallCount: v})} />
          <CalcField label={t("bw.wastage")} unit="%" value={values.wastagePercent} onChange={(v: number) => setValues({...values, wastagePercent: v})} />
        </div>
      </div>
      <div style={{marginTop: '16px'}}><OpeningsEditor openings={openings} onChange={setOpenings} /></div>
      <div className="assumption"><Lightbulb /><span>{t("bw.assumption")}</span></div>
      <button className="btn btn-primary btn-lg" onClick={handleCalculate}><Calculator size={18} />{t("common.calculateMaterials")}</button>
    </div>
    {results.length > 0 && b && <div>
      <div style={{marginTop: '28px', background: 'var(--surface)', borderRadius: '8px', padding: '16px', marginBottom: '20px'}}>
        <h3 style={{marginBottom: '16px', fontSize: '14px', fontWeight: '600'}}>{t("calculation-process").toUpperCase()}</h3>
        <div style={{fontSize: '12px', color: 'var(--muted)', display: 'grid', gap: '14px', overflowWrap: 'anywhere'}}>
          {steps.map(([title, lines]) => <div key={title}>
            <div style={{fontWeight: '600', marginBottom: '4px', color: 'var(--text)'}}>{title}</div>
            {lines.map(l => <div key={l}>{l}</div>)}
          </div>)}
        </div>
      </div>
      <div style={{marginTop: '28px'}}>
        <div className="results-head"><div><span>{t("bw.yourEstimate")}</span><h2>{t("bw.estimatedMaterials")}</h2></div><CheckCircle2 /></div>
        <VolumeUnitSelect value={outputUnit} onChange={setOutputUnit} />
        <div className="results-grid">{results.map(r => <article key={r.label}><span>{tl(r.label)}</span><strong>{q(r.value, outputUnit)}</strong>{r.note && <small>{tn(r.note)}</small>}</article>)}</div>
      </div>
      <div style={{marginTop: '20px', display: 'flex', gap: '12px', flexDirection: 'column'}}>
        <input type="text" aria-label={t("common.calcName")} placeholder={t("bw.namePh")} value={calcName} onChange={(e) => setCalcName(e.target.value)} style={{padding: '10px 14px', minHeight: '44px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--card)', color: 'var(--text)'}} />
        <div className="result-actions">
          <button className="btn btn-primary" onClick={handleSave}><Save size={17} />{initial ? t("common.saveChanges") : t("common.saveCalculation")}</button>
          <button className="btn btn-secondary" onClick={() => setRun(null)} style={{padding: '0 18px'}}>{t("bw.clearResults")}</button>
        </div>
      </div>
    </div>}
  </div>;
}

// Rows describing a saved brickwork calculation (list, report and PDF all use the same wording).
function brickworkRows(c: BrickworkCalculation, t: Translate, q: QuantityText, tl: (label: string) => string = s => s, tv: (value: string) => string = s => s): [string, string][] {
  const isBlock = c.wallType === "cement-block";
  const category = BRICKWORK_CATEGORIES.find(x => x.id === c.categoryId);
  const thicknessInches = category?.thicknesses.find(x => x.id === c.thicknessId)?.inches;
  const unit = outputUnitOf(c);
  const find = (label: string) => c.results?.find(r => r.label === label)?.value;
  const openings = c.openings ?? [];
  const totalOpening = openings.length ? totalOpeningAreaSquareMetres(openings) : Number(c.openingArea) || 0;
  const gross = (convertToMetres(c.wallLength, c.units?.wallLength ?? "m") * convertToMetres(c.wallHeight, c.units?.wallHeight ?? "m")) * (c.wallCount || 1);
  return [
    [t("bw.wallMaterial"), `${t(isBlock ? "cement-block-wall" : "brick-wall")}${c.unitDimensions ? ` (${t(c.unitDimensions.useStandardSize ? "bw.standardSizeShort" : "bw.customSizeShort")})` : ""}`],
    [t("bw.masonry"), category ? tv(category.name) : "—"],
    [t(isBlock ? "bw.blockSize" : "bw.brickSize"), c.unitDimensions ? `${c.unitDimensions.lengthMm} × ${c.unitDimensions.widthMm} × ${c.unitDimensions.heightMm} mm` : tv(find("Unit Size") ?? "—")],
    [t("bw.wallLength"), `${c.wallLength} ${c.units?.wallLength ?? "m"}`],
    [t("bw.wallHeight"), `${c.wallHeight} ${c.units?.wallHeight ?? "m"}`],
    [t("bw.wallCount"), String(c.wallCount || 1)],
    [t(isBlock ? "bw.wallWidth" : "bw.wallThickness"), isBlock && c.wallWidth ? `${c.wallWidth.value} ${c.wallWidth.unit}` : thicknessInches ? `${thicknessInches}"` : find("Wall Width/Thickness") ?? "—"],
    ...openings.map((o, i) => [`${t("opening.n", { n: i + 1 })} · ${o.name || t(`opening.${o.type}`)}`, `${o.width} × ${o.height} ${o.unit} = ${fmtNum(openingAreaSquareMetres(o), 3)} m²`] as [string, string]),
    [t("label.Gross Wall Area"), `${fmtNum(gross, 3)} m²`],
    [t("label.Total Opening Area"), `${fmtNum(totalOpening, 3)} m²`],
    [t("label.Net Wall Area"), `${fmtNum(Math.max(0, gross - totalOpening), 3)} m²`],
    ...(c.results ?? []).filter(r => !["Wall Type", "Gross Wall Area", "Total Opening Area", "Net Wall Area", "Wall Width/Thickness", "Unit Size"].includes(r.label)).map(r => [tl(r.label), q(r.value, unit)] as [string, string]),
    [t("vol.shownIn"), t(`vol.${unit}`)],
  ];
}

function BrickworkCalculator() {
  const { project, setProject, notify, t, tl, tv } = useApp();
  const q = useQuantityText();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const calcs: BrickworkCalculation[] = project.brickworkCalculations || [];
  const editId = searchParams.get("edit");
  const fromReport = searchParams.get("from") === "report";
  const startEditing = editId ? calcs.find(c => c.id === editId) ?? null : null;
  const [editing, setEditing] = useState<BrickworkCalculation | null>(startEditing);
  const [adding, setAdding] = useState(!!startEditing || calcs.length === 0);

  const toList = () => { setEditing(null); setAdding(false); if (editId) setSearchParams({}); };
  const update = (list: BrickworkCalculation[], messageKey: string) => { setProject({ ...project, brickworkCalculations: list }); notify(t(messageKey)); };
  const save = (calc: BrickworkCalculation) => {
    update(upsertById(calcs, calc), calcs.some(c => c.id === calc.id) ? "bw.updated" : "bw.saved");
    if (fromReport) { nav("/report"); return; }
    toList();
  };

  if (adding) return <BrickworkWizard key={editing?.id ?? "new"} initial={editing} existingCount={calcs.length} onSave={save} onCancel={() => fromReport ? nav("/report") : toList()} />;

  const items: SavedItem[] = calcs.map(c => {
    const isBlock = c.wallType === "cement-block";
    const unit = outputUnitOf(c);
    const find = (label: string) => q(c.results?.find(r => r.label === label)?.value ?? "—", unit);
    const estimated = c.results?.find(r => r.label.startsWith("Estimated"));
    const category = BRICKWORK_CATEGORIES.find(x => x.id === c.categoryId);
    const u = c.unitDimensions;
    const wallLabel = t(isBlock ? "cement-block-wall" : "brick-wall");
    const width = isBlock && c.wallWidth ? `${c.wallWidth.value} ${c.wallWidth.unit}` : `${category?.thicknesses.find(x => x.id === c.thicknessId)?.inches ?? "—"}"`;
    return {
      id: c.id,
      title: c.name,
      badge: wallLabel,
      workStatus: c.workStatus ?? "ongoing",
      rows: [
        [t("label.Wall Type"), wallLabel],
        [t("bw.masonry"), `${category ? tv(category.name) : "—"} · ${width}`],
        [t(isBlock ? "bw.blockSize" : "bw.brickSize"), u ? `${u.lengthMm} × ${u.widthMm} × ${u.heightMm} mm` : find("Unit Size")],
        [t("opening.count"), String(c.openings?.length ?? 0)],
        [t("bw.netArea"), find("Net Wall Area")],
        [tl(estimated?.label ?? (isBlock ? "Estimated Cement Blocks" : "Estimated Bricks")), estimated ? tv(estimated.value) : "—"],
        [t("label.Cement"), find("Cement")],
        [t("label.Sand"), find("Sand")],
      ],
      details: <div style={{ display: "grid", gap: "6px", fontSize: "12px" }}>{brickworkRows(c, t, q, tl, tv).map(([k, v], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}><span style={{ color: "var(--muted)" }}>{k}</span><strong style={{ textAlign: "right" }}>{v}</strong></div>)}</div>,
    };
  });
  return <div className="content-wrap">
    <div className="content-heading"><span className="eyebrow"><span />{t("bw.eyebrow")}</span><h2>{t("bw.listTitle")}</h2><p>{t("bw.listText")}</p></div>
    <SavedCalculationList heading={t("bw.listTitle")} items={items} labels={listLabels(t)}
      totals={localizeTotals(sumQuantities(calcs.map(c => c.results), TOTAL_LABELS.brickwork), tl).map(r => ({ ...r, value: q(r.value) }))}
      addLabel={t(calcs.length ? "bw.addAnother" : "bw.add")} emptyText={t("bw.empty")}
      onAdd={() => { setEditing(null); setAdding(true); }}
      onEdit={id => { const c = calcs.find(x => x.id === id); if (c) { setEditing(c); setAdding(true); } }}
      onDuplicate={id => update(duplicateById(calcs, id, c => stampRecord({ ...c, name: `${c.name} (${t("copy")})`, createdAt: undefined })), "bw.duplicated")}
      onDelete={id => update(removeById(calcs, id), "bw.deleted")}
      onToggleStatus={id => update(toggleWorkStatus(calcs, id), "status.updated")} />
  </div>;
}

function Checklist({ stage, onComplete, onReopen }: any) {
  const { project, setProject, t } = useApp(); const checks = project.checklists[stage.id] || [false, false, false, false]; const count = checks.filter(Boolean).length;
  const done = project.completed.includes(stage.id);
  const records = stageRecords(project, stage.id);
  const blocker = completionBlocker(project, stage.id);
  const completeCard = <div className="complete-card"><div>
    <h3>{t(done ? "check.completedTitle" : "check.readyTitle")}</h3>
    <p>{t(done ? "check.completedText" : "check.readyText")}</p>
    {records.length > 0 && <p style={{ color: "var(--muted)", fontSize: "13px" }}>{t("check.recordsDone", { done: records.filter(isRecordCompleted).length, total: records.length })}</p>}
    {!done && blocker && <p role="status" style={{ color: "var(--muted)", fontSize: "13px" }}>{t(`check.blocked.${blocker}`)}</p>}
  </div>
    {done
      ? <button className="btn btn-secondary" onClick={onReopen}>{t("check.markOngoing")}<Undo2 size={17} /></button>
      : <button className="btn btn-primary" disabled={!!blocker} onClick={onComplete}>{t("check.markComplete")}<Check size={17} /></button>}
  </div>;
  const toggle = (i: number) => { const next = [...checks]; next[i] = !next[i]; setProject({ ...project, checklists: { ...project.checklists, [stage.id]: next } }); };
  return <div className="content-wrap narrow"><div className="content-heading"><span className="eyebrow"><span />{t("check.eyebrow")}</span><h2>{t("check.title")}</h2><p>{t("check.text")}</p></div><div className="check-progress"><div><strong>{t("check.count", { done: count, total: checks.length })}</strong><span>{Math.round(count / checks.length * 100)}%</span></div><ProgressBar value={count / checks.length * 100} /></div><div className="checklist">{CHECKLIST_KEYS.map((key, i) => <button className={checks[i] ? "checked" : ""} onClick={() => toggle(i)} key={key} aria-pressed={!!checks[i]}><span>{checks[i] && <Check />}</span><p>{t(key)}</p></button>)}</div>{count === checks.length && <div className="success-box"><CheckCircle2 /><div><strong>{t("check.doneTitle")}</strong><p>{t("check.doneText")}</p></div></div>}{completeCard}</div>;
}

function ProgressPage() {
  const { project, t } = useApp();
  const allStageIds = getAllStageIds(STAGES);
  const value = Math.round(project.completed.length / allStageIds.length * 100);
  return <AppShell back="/dashboard"><div className="page-head"><div><span className="eyebrow"><span />{t("prog.eyebrow")}</span><h1>{t("prog.title")}</h1><p>{t("prog.text")}</p></div></div><section className="progress-summary"><div className="ring" style={{ "--p": `${value * 3.6}deg` } as any}><div><strong>{value}%</strong><span>{t("prog.complete")}</span></div></div><div><h2>{project.name}</h2><p>{t("prog.summary", { done: project.completed.length, remaining: allStageIds.length - project.completed.length })}</p><ProgressBar value={value} /></div></section><div className="timeline">{STAGES.map((s, i) => {
    const stageLabel = t("stage.number", { n: String(i + 1).padStart(2, "0") });
    if (!s.children) {
      const done = project.completed.includes(s.id);
      const current = !done && getAllStageIds(STAGES).find(x => !project.completed.includes(x)) === s.id;
      return <Link to={`/stage/${s.id}`} className="timeline-row" key={s.id}><div className={`timeline-marker ${done ? "done" : current ? "current" : ""}`}>{done ? <Check /> : <span>{i + 1}</span>}</div><div><small>{stageLabel}</small><h3>{t(s.id)}</h3><p>{t(`stageDesc.${s.id}`)}</p></div><StatusBadge status={done ? "completed" : current ? "progress" : "not-started"} /><ChevronRight /></Link>;
    } else {
      const completedCount = s.children.filter(c => project.completed.includes(c.id)).length;
      const totalCount = s.children.length;
      return <Link to={`/stage/${s.id}`} className="timeline-row" key={s.id}><div className={`timeline-marker ${completedCount === totalCount ? "done" : completedCount > 0 ? "current" : ""}`}>{completedCount === totalCount ? <Check /> : <span>{i + 1}</span>}</div><div><small>{stageLabel}</small><h3>{t(s.id)}</h3><p>{t("prog.activities", { done: completedCount, total: totalCount })}</p></div><StatusBadge status={completedCount === totalCount ? "completed" : completedCount > 0 ? "progress" : "not-started"} /><ChevronRight /></Link>;
    }
  })}</div></AppShell>;
}
const reportEditButton = { minHeight: '44px', padding: '8px 16px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text)' } as const;

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={{ border: "1px solid var(--border)", borderRadius: "11px", marginTop: "24px", overflow: "hidden" }}>
    <h3 style={{ margin: 0, background: "var(--surface)", padding: "12px 16px", fontSize: "13.5px" }}>{title}</h3>
    {children}
  </section>;
}

function ReportItem({ index, title, subtitle, status, rows, editLabel, onEdit, children }: { index: number; title: string; subtitle?: string; status?: "ongoing" | "completed"; rows: [string, string][]; editLabel: string; onEdit: () => void; children?: React.ReactNode }) {
  return <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
      <div><strong>{padIndex(index)} — {title}</strong> <WorkStatusBadge status={status ?? "ongoing"} />{subtitle && <small style={{ display: "block", color: "var(--muted)" }}>{subtitle}</small>}</div>
      <button onClick={onEdit} style={reportEditButton}><Pencil size={16} />{editLabel}</button>
    </div>
    <div style={{ display: "grid", gap: "6px", marginTop: "10px" }}>
      {rows.map(([k, v], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "13px" }}><span style={{ color: "var(--muted)" }}>{k}</span><strong style={{ textAlign: "right" }}>{v}</strong></div>)}
    </div>
    {children}
  </div>;
}

function ReportPage() {
  const { project, notify, t, tl, tv, language } = useApp();
  const nav = useNavigate();
  const allStageIds = getAllStageIds(STAGES);
  const foundation: FoundationCalculation[] = project.foundationCalculations || [];
  const brick: BrickworkCalculation[] = project.brickworkCalculations || [];
  const concrete: CementWorksCalculation[] = project.cementWorksCalculations || [];
  const rebar: ReinforcementCalculation[] = project.reinforcementCalculations || [];
  const english_t: Translate = (key, vars) => translate("en", key, vars);

  function download() {
    const pdf = new jsPDF();
    pdf.setTextColor(22, 163, 74);
    pdf.setFontSize(22);
    pdf.text("HOUSE BUILD GUIDE", 20, 22);
    pdf.setTextColor(31, 41, 55);
    pdf.setFontSize(14);
    pdf.text(`Project: ${project.name}`, 20, 36);
    pdf.setFontSize(10);
    pdf.text(`Generated: ${new Date().toLocaleDateString()}  |  Progress: ${Math.round(project.completed.length / allStageIds.length * 100)}%`, 20, 44);
    let y = 58;
    const line = (text: string, x: number, size: number, gap: number) => {
      if (y > 280) { pdf.addPage(); y = 20; }
      pdf.setFontSize(size);
      pdf.text(text, x, y);
      y += gap;
    };
    const totalsLines = (title: string, rows: { label: string; value: string }[]) => {
      if (!rows.length) return;
      line(title, 20, 12, 7);
      rows.forEach(r => line(`${r.label}: ${r.value}`, 25, 10, 6));
      y += 4;
    };

    const statusText = (s?: string) => english_t(s === "completed" ? "status.completed" : "status.ongoing");
    const inCubes = (rows: { label: string; value: string }[]) => rows.map(r => ({ ...r, value: englishQuantity(r.value) }));
    foundation.forEach((f, i) => {
      line(`Foundation ${padIndex(i)}: ${f.name}`, 20, 13, 8);
      line(`Method: ${english_t(FOUNDATION_METHOD_KEY[f.method])}   Status: ${statusText(f.workStatus)}`, 25, 10, 7);
      foundationRows(f, english_t, englishQuantity).forEach(([k, v]) => line(`${k}: ${v}`, 25, 10, 7));
      y += 4;
    });
    if (foundation.length > 1) totalsLines("Combined Foundation Totals", inCubes(sumQuantities(foundation.map(f => f.results), TOTAL_LABELS.foundation)));

    brick.forEach((calc, i) => {
      line(`Brickwork ${padIndex(i)}: ${calc.name}`, 20, 13, 8);
      line(`Status: ${statusText(calc.workStatus)}`, 25, 10, 7);
      brickworkRows(calc, english_t, englishQuantity).forEach(([k, v]) => line(`${k}: ${v}`, 25, 10, 7));
      y += 4;
    });
    if (brick.length > 1) totalsLines("Combined Brickwork Totals", inCubes(sumQuantities(brick.map(c => c.results), TOTAL_LABELS.brickwork)));

    if (concrete.length || rebar.length) {
      const rebarLines = (calc: ReinforcementCalculation, x: number) => {
        const r = calc.results;
        line(`Reinforcement Estimate: ${calc.calculationName}`, x, 11, 6);
        [
          `Main Bar Size: ${calc.mainBarDiameter || "-"}   Longitudinal Runs: ${r.totalRuns} (${calc.barGroups.filter(g => g.count > 0).map(g => `${g.key} ${g.count}`).join(", ")} x ${calc.memberCount})`,
          `Member Length: ${fmtNum(calc.memberLength.value)} ${calc.memberLength.unit} (${fmtNum(r.memberLengthFt)} ft)   Stock Bar: ${fmtNum(calc.stockBarLengthFt)} ft   Lap: ${fmtNum(calc.lapLengthFt)} ft`,
          `Bars Per Run: ${r.barsPerRun}   Longitudinal Stock Bars: ${r.totalStockBars}   Purchased: ${fmtNum(r.totalPurchasedFt)} ft   Total Lap: ${fmtNum(r.totalLapLengthFt)} ft`,
          ...(calc.stirrup && r.stirrups
            ? [`Stirrup Steel: ${calc.stirrup.size.replace("1/4\"", "1/4 in")}   Spacing: ${fmtNum(calc.stirrup.spacing.value)} ${calc.stirrup.spacing.unit}   Quantity: ${r.stirrups.total}   Total Length: ${fmtNum(r.stirrups.totalLengthFt)} ft   Stock Bars: ${r.stirrups.stockBars}`]
            : ["Stirrups: not included"]),
        ].forEach(text => line(text, x + 5, 9, 5));
        y += 2;
      };
      line("Cement Works", 20, 13, 8);
      concrete.forEach(cw => {
        const cfg = getCategoryConfig(cw.category);
        line(`${cw.name} (${cw.category})   Status: ${statusText(cw.workStatus)}`, 25, 11, 6);
        if (cfg?.volumeOutput) {
          // Plastering: each typed dimension with its unit, the 1 : 5 ratio, then quantities in the saved display unit.
          cfg.summary(cw).forEach(([k, v]) => line(`${k}: ${v}`, 35, 9, 5));
          (cw.results || []).forEach((r: QuantityResult) => line(`${r.label}: ${englishQuantity(r.value, outputUnitOf(cw))}`, 35, 9, 5));
          y += 3;
          return;
        }
        line("Concrete Estimate", 30, 10, 5);
        if (cw.staircase) {
          const s = cw.staircase;
          const d = (label: string, m: { value: number; unit: string; feet: number }) => line(`${label}: ${m.value} ${m.unit} (${round3(m.feet)} ft)`, 35, 9, 5);
          line(`Treads: ${s.numberOfTreads}   Risers: ${s.numberOfRisers}`, 35, 9, 5);
          d("Tread Depth", s.treadDepth); d("Riser Height", s.riserHeight); d("Stair Width", s.stairWidth); d("Waist Slab Thickness", s.waistThickness);
          if (s.landing) { d("Landing Length", s.landing.length); d("Landing Width", s.landing.width); d("Landing Thickness", s.landing.thickness); line(`Landings: ${s.landing.count}`, 35, 9, 5); }
          line(`Horizontal Run: ${round3(s.results.horizontalRunFt)} ft   Vertical Rise: ${round3(s.results.verticalRiseFt)} ft   Slope Length: ${round3(s.results.slopeLengthFt)} ft`, 35, 9, 5);
        }
        (cw.results || []).forEach((r: QuantityResult) => line(`${r.label}: ${r.value}`, 35, 9, 5));
        rebar.filter(rc => rc.linkedConcreteId === cw.id).forEach(rc => rebarLines(rc, 30));
        y += 3;
      });
      const unlinked = rebar.filter(rc => !rc.linkedConcreteId || !concrete.some(cw => cw.id === rc.linkedConcreteId));
      unlinked.forEach(rc => rebarLines(rc, 25));
      totalsLines("Combined Cement Works Totals", [
        ...(concrete.length > 1 ? sumQuantities(concrete.map(c => c.results), TOTAL_LABELS.cementWorks) : []),
        ...(concrete.length > 1 ? stairConcreteTotal(concrete, "Stair Case Concrete (all staircases)") : []),
        ...(rebar.length > 1 ? sumReinforcement(rebar, english_t) : []),
      ]);
    }

    pdf.save(`${project.name.replace(/\s/g, "-").toLowerCase()}-quantities.pdf`);
    notify(t("report.generated"));
  }

  const dateText = new Date().toLocaleDateString(language === "si" ? "si-LK" : "en-GB");
  const q = useQuantityText();
  return <AppShell back="/dashboard">
    <div className="page-head">
      <div>
        <span className="eyebrow"><span />{t("report.eyebrow")}</span>
        <h1>{t("report.title")}</h1>
        <p>{t("report.text")}</p>
      </div>
      <div style={{display: 'grid', gap: '6px', justifyItems: 'end'}}>
        <button className="btn btn-primary" onClick={download}><Download size={18} />{t("report.downloadPdf")}</button>
        {language !== "en" && <small style={{color: 'var(--muted)', maxWidth: '320px', textAlign: 'right'}}>{t("report.pdfEnglishOnly")}</small>}
      </div>
    </div>
    <section className="report-paper">
      <div className="report-brand"><Logo /><span>{t("report.brand")}</span></div>
      <div className="report-meta"><div><span>{t("report.projectName")}</span><strong>{project.name}</strong></div><div><span>{t("report.generatedOn")}</span><strong>{dateText}</strong></div><div><span>{t("progress")}</span><strong>{Math.round(project.completed.length / allStageIds.length * 100)}%</strong></div></div>

      <h2>{t("report.saved")}</h2>

      {foundation.length > 0 && <ReportSection title={t("foundation")}>
        {foundation.map((f, i) => <ReportItem key={f.id} index={i} title={f.name} subtitle={`${t("fnd.methodLabel")}: ${t(FOUNDATION_METHOD_KEY[f.method])}`} editLabel={t("edit")} onEdit={() => nav(`/stage/foundation?edit=${f.id}&from=report`)}
          status={f.workStatus}
          rows={foundationRows(f, t, q)}>
          {f.plan && <div style={{marginTop: '12px'}}><small style={{color: 'var(--muted)'}}>{t("fnd.planPreview")}</small><PlanPreview plan={f.plan} maxHeight={220} /></div>}
        </ReportItem>)}
        {foundation.length > 1 && <div style={{padding: '0 16px 16px'}}><TotalsPanel title={t("report.combinedFoundation")} totals={localizeTotals(sumQuantities(foundation.map(f => f.results), TOTAL_LABELS.foundation), tl).map(r => ({ ...r, value: q(r.value) }))} count={foundation.length} /></div>}
      </ReportSection>}

      {brick.length > 0 && <ReportSection title={t("brickwork")}>
        {brick.map((calc, i) => <ReportItem key={calc.id} index={i} title={calc.name} editLabel={t("edit")} onEdit={() => nav(`/stage/brickwork?edit=${calc.id}&from=report`)}
          status={calc.workStatus}
          rows={brickworkRows(calc, t, q, tl, tv)} />)}
        {brick.length > 1 && <div style={{padding: '0 16px 16px'}}><TotalsPanel title={t("report.combinedBrickwork")} totals={localizeTotals(sumQuantities(brick.map(c => c.results), TOTAL_LABELS.brickwork), tl).map(r => ({ ...r, value: q(r.value) }))} count={brick.length} /></div>}
      </ReportSection>}

      {(concrete.length > 0 || rebar.length > 0) && (() => {
        const rebarBlock = (rc: ReinforcementCalculation) => <div key={rc.id} style={{marginTop: '12px', padding: '12px', background: 'var(--surface)', borderRadius: '8px'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap'}}>
            <div><small style={{color: 'var(--muted)'}}>{t("rebar.reportSection").toUpperCase()}</small><div><strong>{rc.calculationName}</strong></div></div>
            <button onClick={() => nav(`/stage/cement-works?rebar=${rc.id}&from=report`)} style={reportEditButton}><Pencil size={16} />{t("rebar.editReinforcement")}</button>
          </div>
          <ReinforcementSummary calc={rc} />
        </div>;
        const unlinked = rebar.filter(rc => !rc.linkedConcreteId || !concrete.some(cw => cw.id === rc.linkedConcreteId));
        const totals = [
          ...(concrete.length > 1 ? localizeTotals(sumQuantities(concrete.map(c => c.results), TOTAL_LABELS.cementWorks), tl) : []),
          ...(concrete.length > 1 ? stairConcreteTotal(concrete, t("stair.combinedTotal")) : []),
          ...(rebar.length > 1 ? sumReinforcement(rebar, t) : []),
        ];
        return <ReportSection title={t("cement-works")}>
          {concrete.map((cw, i) => <ReportItem key={cw.id} index={i} title={cw.name} subtitle={catText(t, cw.category, "singular")} editLabel={t("edit")} onEdit={() => nav(`/stage/cement-works?edit=${cw.id}&from=report`)}
            status={cw.workStatus}
            rows={cw.staircase ? staircaseReportRows(cw.staircase, t) : getCategoryConfig(cw.category)?.volumeOutput
              ? [...localizeRows(getCategoryConfig(cw.category)!.summary(cw), tl, tv), ...(cw.results || []).filter(r => r.label || r.value).map(r => [tl(r.label), q(r.value, outputUnitOf(cw))] as [string, string])]
              : (cw.results || []).filter(r => r.label || r.value).map(r => [tl(r.label), tv(r.value)] as [string, string])}>
            {rebar.filter(rc => rc.linkedConcreteId === cw.id).map(rebarBlock)}
          </ReportItem>)}
          {unlinked.length > 0 && <div style={{padding: '14px 16px', borderTop: '1px solid var(--border)'}}>
            {concrete.length > 0 && <small style={{color: 'var(--muted)'}}>{t("rebar.unlinked")}</small>}
            {unlinked.map(rebarBlock)}
          </div>}
          {totals.length > 0 && <div style={{padding: '0 16px 16px'}}><TotalsPanel title={t("cw.combinedTotals")} totals={totals} count={concrete.length + rebar.length} /></div>}
        </ReportSection>;
      })()}

      {!foundation.length && !brick.length && !concrete.length && !rebar.length && <div className="empty"><Calculator /><h3>{t("report.emptyTitle")}</h3><p>{t("report.emptyText")}</p><Link to="/stage/foundation" className="btn btn-primary">{t("report.startFoundation")}</Link></div>}
    </section>
  </AppShell>;
}

export default function App() {
  const protect = (page: React.ReactNode) => <RequireAuth>{page}</RequireAuth>;
  return <ThemeProvider><LanguageProvider><AuthProvider><AppProvider><BrowserRouter><Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/login" element={<AuthPage />} />
    <Route path="/register" element={<AuthPage register />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/dashboard" element={protect(<Dashboard />)} />
    <Route path="/stage/:id" element={protect(<StagePage />)} />
    <Route path="/progress" element={protect(<ProgressPage />)} />
    <Route path="/report" element={protect(<ReportPage />)} />
    <Route path="/profile" element={protect(<ProfilePage />)} />
    <Route path="*" element={<NotFound />} />
  </Routes></BrowserRouter></AppProvider></AuthProvider></LanguageProvider></ThemeProvider>;
}

function NotFound() {
  const { t } = useApp();
  return <div><Navbar /><main className="section"><div className="container empty"><h3>{t("notFound.title")}</h3><p>{t("notFound.text")}</p><Link to="/" className="btn btn-primary">{t("notFound.home")}</Link></div></main></div>;
}
