(() => {
  const storageKey = 'aardvarkland-mini-language';
  const languages = [
    { code: 'cs', html: ['cs'], legacy: 'CZ', label: 'Čeština', file: 'cz.svg' },
    { code: 'en', html: ['en'], legacy: 'GB', label: 'English', file: 'gb.svg' },
    { code: 'ua', html: ['uk', 'ua'], legacy: 'UA', label: 'Українська', file: 'ua.svg' },
    { code: 'fr', html: ['fr'], legacy: 'FR', label: 'Français', file: 'fr.svg' },
    { code: 'de', html: ['de'], legacy: 'DE', label: 'Deutsch', file: 'de.svg' },
    { code: 'es', html: ['es'], legacy: 'ES', label: 'Español', file: 'es.svg' },
  ];
  const byCode = new Map(languages.map((language) => [language.code, language]));
  let selectedCode = readSelectedLanguage();
  let scheduled = false;

  function normalized(value) {
    return String(value ?? '').trim().toLocaleLowerCase();
  }

  function readSelectedLanguage() {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored && byCode.has(stored)) return stored;
    } catch {}

    const htmlLanguage = normalized(document.documentElement.lang);
    const matching = languages.find((language) => language.html.some((code) => htmlLanguage === code || htmlLanguage.startsWith(`${code}-`)));
    return matching?.code ?? 'en';
  }

  function languageForButton(button, index) {
    const existing = button.dataset.languageCode;
    if (existing && byCode.has(existing)) return byCode.get(existing);

    const markerText = normalized(button.firstElementChild?.textContent);
    const fullText = normalized(button.textContent);
    return languages.find((language) => (
      markerText === normalized(language.legacy)
      || fullText.includes(normalized(language.label))
    )) ?? languages[index] ?? null;
  }

  function decorateMenu() {
    const menu = document.querySelector('.language-menu__list');
    if (!menu) return;

    const buttons = [...menu.querySelectorAll('button')];
    buttons.forEach((button, index) => {
      const language = languageForButton(button, index);
      if (!language) return;

      if (button.dataset.languageCode !== language.code) {
        button.dataset.languageCode = language.code;
      }

      const visual = button.querySelector('.language-flag') ?? button.firstElementChild;
      if (visual) {
        if (!visual.classList.contains('language-flag-image')) {
          visual.classList.add('language-flag-image');
        }
        if (visual.dataset.languageCode !== language.code) {
          visual.dataset.languageCode = language.code;
        }
        if (visual.getAttribute('aria-hidden') !== 'true') {
          visual.setAttribute('aria-hidden', 'true');
        }
      }
    });

    const activeButton = buttons.find((button) => (
      button.getAttribute('aria-checked') === 'true'
      || button.classList.contains('is-active')
    ));
    if (activeButton) {
      const activeLanguage = languageForButton(activeButton, buttons.indexOf(activeButton));
      if (activeLanguage) selectedCode = activeLanguage.code;
    }
  }

  function decorateTrigger() {
    const trigger = document.querySelector('.language-switch');
    if (!trigger) return;

    const liveCode = readSelectedLanguage();
    if (byCode.has(liveCode)) selectedCode = liveCode;
    const language = byCode.get(selectedCode) ?? byCode.get('en');

    if (trigger.dataset.languageCode !== language.code) {
      trigger.dataset.languageCode = language.code;
    }
    const accessibleLabel = `Language: ${language.label}`;
    if (trigger.getAttribute('aria-label') !== accessibleLabel) {
      trigger.setAttribute('aria-label', accessibleLabel);
    }
    if (trigger.getAttribute('title') !== language.label) {
      trigger.setAttribute('title', language.label);
    }
  }

  function decorate() {
    decorateMenu();
    decorateTrigger();
  }

  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      decorate();
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('.language-menu__list button')
      : null;
    if (!button) return;

    const buttons = [...button.parentElement.querySelectorAll('button')];
    const language = languageForButton(button, buttons.indexOf(button));
    if (language) {
      selectedCode = language.code;
      try {
        window.localStorage.setItem(storageKey, language.code);
      } catch {}
      const trigger = document.querySelector('.language-switch');
      if (trigger) trigger.dataset.languageCode = language.code;
    }
    scheduleDecorate();
  }, true);

  const observer = new MutationObserver(scheduleDecorate);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['lang', 'class', 'aria-checked'],
  });

  scheduleDecorate();
})();
