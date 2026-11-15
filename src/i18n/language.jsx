// src/i18n/language.js
// Lightweight English / Sinhala switch.
//
// Usage:  tr('English text', 'සිංහල පෙළ')
// - Works anywhere (components, helpers, print-HTML builders) because it reads
//   the current language at call time.
// - App subscribes via useLang(), so switching re-renders the whole tree
//   in place without losing component state.

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'appLang';
const listeners = new Set();

const readInitial = () => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved === 'si' ? 'si' : 'en';
    } catch {
        return 'en';
    }
};

let currentLang = readInitial();

export const getLang = () => currentLang;

export const setLang = (lang) => {
    const next = lang === 'si' ? 'si' : 'en';
    if (next === currentLang) return;
    currentLang = next;
    try {
        localStorage.setItem(STORAGE_KEY, next);
    } catch {
        /* ignore storage errors */
    }
    document.documentElement.lang = next;
    listeners.forEach((fn) => fn());
};

export const toggleLang = () => setLang(currentLang === 'si' ? 'en' : 'si');

const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};

export const useLang = () => useSyncExternalStore(subscribe, getLang, getLang);

/** Translate: returns the English or Sinhala variant for the current language. */
export const tr = (en, si) => (currentLang === 'si' ? si : en);

export const LanguageToggle = ({ style, className = '' }) => {
    const lang = useLang();
    const btn = (code, label) => (
        <button
            type="button"
            onClick={() => setLang(code)}
            className={`btn btn-sm ${lang === code ? 'btn-light' : 'btn-outline-light'}`}
            style={{ fontWeight: 'bold', minWidth: 44 }}
            aria-pressed={lang === code}
        >
            {label}
        </button>
    );
    return (
        <div className={`btn-group ${className}`} role="group" aria-label="Language" style={style}>
            {btn('en', 'EN')}
            {btn('si', 'සිං')}
        </div>
    );
};
