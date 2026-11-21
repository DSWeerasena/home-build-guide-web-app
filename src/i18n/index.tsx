import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translate, translateText, type Language, type Translate } from "./translate.ts";

export { translate, translateText, type Language, type Translate };
const STORAGE_KEY = "hbg-lang";

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
  tl: (label: string) => string;
  tn: (note: string) => string;
  tv: (value: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function initialLanguage(): Language {
  try { return localStorage.getItem(STORAGE_KEY) === "si" ? "si" : "en"; } catch { return "en"; }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, language); } catch { /* preference simply isn't remembered */ }
    document.documentElement.lang = language;
  }, [language]);
  const value: LanguageContextValue = {
    language,
    setLanguage,
    t: (key, vars) => translate(language, key, vars),
    tl: label => translateText(language, "label", label),
    tn: note => translateText(language, "note", note),
    tv: v => translateText(language, "value", v),
  };
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}
