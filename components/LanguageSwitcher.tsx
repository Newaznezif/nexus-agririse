"use client";
import { useState, useEffect } from "react";
import { Globe, ChevronDown } from "lucide-react";

declare global {
  interface Window {
    googleTranslateElementInit: () => void;
    google: any;
  }
}

const languages = [
  { code: "en", name: "English", label: "EN" },
  { code: "am", name: "Amharic", label: "አማ" },
  { code: "rw", name: "Kinyarwanda", label: "RW" },
  { code: "sg", name: "Sango", label: "SG" },
  { code: "sw", name: "Swahili", label: "SW" },
];

export const LanguageSwitcher = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentLang, setCurrentLang] = useState("en");

  useEffect(() => {
    // 1. Initialize Hidden Widget
    const addScript = () => {
      const script = document.createElement("script");
      script.src = "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
      script.async = true;
      document.body.appendChild(script);
    };

    window.googleTranslateElementInit = () => {
      new window.google.translate.TranslateElement(
        {
          pageLanguage: "en",
          includedLanguages: "en,am,rw,sg,sw",
          autoDisplay: false,
        },
        "google_translate_element"
      );
    };

    if (!window.google?.translate) {
      addScript();
    }

    // Load initial language from cookie or localStorage
    const getCookie = (name: string) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop()?.split(";").shift();
      return null;
    };

    const savedLangCookie = getCookie("googtrans");
    if (savedLangCookie) {
      const lang = savedLangCookie.split("/").pop();
      if (lang) setCurrentLang(lang);
    } else {
      const savedLangLocal = localStorage.getItem("language");
      if (savedLangLocal) setCurrentLang(savedLangLocal);
    }

    // Aggressively force body top to 0
    const forceBodyTop = () => {
      document.body.style.top = "0px";
      document.body.style.position = "static";
    };

    const interval = setInterval(forceBodyTop, 100);
    return () => clearInterval(interval);
  }, []);

  // 2. Custom Trigger Function
  const setLanguage = (langCode: string) => {
    // Set persistence via cookie (Standard Google Translate requirement)
    const domain = window.location.hostname;
    document.cookie = `googtrans=/en/${langCode}; path=/`;
    document.cookie = `googtrans=/en/${langCode}; path=/; domain=.${domain}`;
    
    // Select language in hidden widget
    const googleCombo = document.querySelector(".goog-te-combo") as HTMLSelectElement;
    if (googleCombo) {
      googleCombo.value = langCode;
      googleCombo.dispatchEvent(new Event("change"));
    }

    setCurrentLang(langCode);
    localStorage.setItem("language", langCode);
    
    // Optional: Refresh if translation doesn't trigger immediately
    // window.location.reload(); 
  };

  const handleLangChange = (langCode: string) => {
    setLanguage(langCode);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 dark:border-zinc-800 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-900 transition-all active:scale-95"
      >
        <Globe size={16} className="text-emerald-600 dark:text-emerald-400" />
        <span>{languages.find((l) => l.code === currentLang)?.label}</span>
        <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-zinc-950 border border-gray-100 dark:border-zinc-800 rounded-2xl shadow-2xl z-[100] py-2 animate-in fade-in zoom-in duration-200">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleLangChange(lang.code)}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-900/20 ${
                currentLang === lang.code
                  ? "text-emerald-600 dark:text-emerald-400 font-bold"
                  : "text-gray-600 dark:text-gray-400 font-medium"
              }`}
            >
              <span>{lang.name}</span>
              {currentLang === lang.code && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
            </button>
          ))}
        </div>
      )}

      {/* Hidden container for Google Translate Widget */}
      <div id="google_translate_element" className="fixed top-[-1000px] left-[-1000px] opacity-0 pointer-events-none" />

      {/* 3. Force Body Top & Hide Banner */}
      <style jsx global>{`
        .goog-te-banner-frame,
        .goog-te-banner-frame.skiptranslate,
        .goog-te-gadget-icon,
        .goog-logo-link,
        .goog-te-gadget span,
        #goog-gt-tt,
        .goog-te-balloon-frame {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }
        body {
          top: 0 !important;
          position: static !important;
        }
        .skiptranslate {
          display: none !important;
        }
        .goog-text-highlight {
          background-color: transparent !important;
          box-shadow: none !important;
        }
      `}</style>
    </div>
  );
};
