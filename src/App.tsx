import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadBackup } from './backup';
import { downloadImportTemplate, exportReportCsv, exportReportPdf, exportWorkbook, importProductsFile, reportRows } from './dataExchange';
import { applyMovement, createId, deleteLocation, deleteProduct, emptyMiniState, stockAt, totalStock, updateLocation, updateProduct } from './domain';
import { copyFor, languageOptions, locales, movementLabel } from './i18n';
import { getStorageBackend, loadMiniState, parseMiniBackup, saveMiniState, type StorageBackend } from './storage';
import type { Language, MiniLocation, MiniProduct, MiniState, MovementType } from './types';
import { disableNotifications, enableNotifications, notificationsEnabled, notifyExpiry } from './notifications';
import { disablePin, readLock, setPin, verifyPin } from './security';

type Tab = 'dashboard' | 'stock' | 'operations' | 'history' | 'reports' | 'data';
type ThemeMode = 'light' | 'dark';
type IconName = 'dashboard' | 'stock' | 'scan' | 'history' | 'reports' | 'data' | 'receipt' | 'issue' | 'move' | 'count' | 'search' | 'camera' | 'database' | 'location' | 'product';

const languageKey = 'aardvarkland-mini-language';
const themeKey = 'aardvarkland-ui-theme';
const CameraScanner = lazy(() => import('./CameraScanner').then((module) => ({ default: module.CameraScanner })));

function readTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(themeKey);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function App() {
  const [language, setLanguage] = useState<Language>(readLanguage);
  const copy = copyFor(language);
  const [state, setState] = useState<MiniState>(emptyMiniState);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [message, setMessage] = useState('');
  const [operationPreset, setOperationPreset] = useState<MovementType>('RECEIPT');
  const [warehouseDraft, setWarehouseDraft] = useState('');
  const [storageBackend, setStorageBackend] = useState<StorageBackend>(getStorageBackend());
  const [locked, setLocked] = useState(Boolean(readLock()));
  const [onboardingStep, setOnboardingStep] = useState(0);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void loadMiniState().then((loaded) => {
      if (!active) return;
      setState(loaded);
      setWarehouseDraft(loaded.warehouseName);
      setStorageBackend(getStorageBackend());
      setReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveMiniState(state).then(setStorageBackend); }, 80);
    return () => window.clearTimeout(saveTimer.current);
  }, [ready, state]);

  useEffect(() => { if (ready) void notifyExpiry(state, language); }, [ready, state, language]);
  useEffect(() => { const onVisibility=()=>{if(document.visibilityState==='hidden'&&readLock())setLocked(true)};document.addEventListener('visibilitychange',onVisibility);return()=>document.removeEventListener('visibilitychange',onVisibility);},[]);

  useEffect(() => {
    document.documentElement.lang = locales[language];
    window.localStorage.setItem(languageKey, language);
  }, [language]);

  const notify = useCallback((value: string) => {
    setMessage(value);
    window.setTimeout(() => setMessage((current) => current === value ? '' : current), 3200);
  }, []);

  if (!ready) return (
    <div className="boot-screen">
      <img src="./icons/icon-512.png" alt="" />
      <strong>Aardvarkland</strong>
    </div>
  );
  if (locked) return <LockScreen copy={copy} onUnlock={()=>setLocked(false)} />;

  const navigation: Array<{ id: Tab; label: string; icon: IconName }> = [
    { id: 'dashboard', label: copy.navDashboard, icon: 'dashboard' },
    { id: 'stock', label: copy.navStock, icon: 'stock' },
    { id: 'operations', label: copy.navOperations, icon: 'scan' },
    { id: 'history', label: copy.navHistory, icon: 'history' },
    { id: 'reports', label: copy.navReports, icon: 'reports' },
    { id: 'data', label: copy.navData, icon: 'data' },
  ];

  const openOperation = (type: MovementType) => {
    setOperationPreset(type);
    setTab('operations');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><img src="./icons/icon-512.png" alt="" /></span>
          <span className="brand-copy"><strong>Aardvarkland <em>MINI</em></strong><small>{copy.appSubtitle}</small></span>
        </div>
        <div className="topbar-actions">
          <LanguageMenu language={language} setLanguage={setLanguage} copy={copy} />
          <ThemeToggle language={language} />
        </div>
      </header>

      <aside className="sidebar">
        <div className="warehouse-box">
          <label>{copy.warehouse}</label>
          <input value={warehouseDraft} placeholder={copy.warehousePlaceholder} onChange={(event) => setWarehouseDraft(event.target.value)} />
          <button type="button" className="button button--small" onClick={() => {
            const warehouseName = warehouseDraft.trim().slice(0, 120);
            setState((current) => ({ ...current, warehouseName, updatedAt: new Date().toISOString() }));
            notify(copy.saved);
          }}>{copy.saveName}</button>
        </div>
        <nav>
          {navigation.map((item) => (
            <button type="button" key={item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>
              <span className="nav-icon" aria-hidden="true"><UiIcon name={item.icon} /></span><span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="local-note"><span>●</span><div><strong>{copy.localOnly}</strong><small>{copy.saved}</small></div></div>
      </aside>

      <main className="main">
        {tab === 'dashboard' && <Dashboard state={state} language={language} onNavigate={setTab} onStartOperation={openOperation} />}
        {tab === 'stock' && <Stock state={state} setState={setState} copy={copy} notify={notify} />}
        {tab === 'operations' && <Operations state={state} setState={setState} copy={copy} notify={notify} initialType={operationPreset} />}
        {tab === 'history' && <History state={state} language={language} copy={copy} />}
        {tab === 'reports' && <Reports state={state} copy={copy} />}
        {tab === 'data' && <DataTools state={state} setState={setState} setWarehouseDraft={setWarehouseDraft} storageBackend={storageBackend} copy={copy} notify={notify} />}
      </main>

      <nav className="mobile-nav">
        {navigation.map((item) => (
          <button type="button" key={item.id} className={tab === item.id ? 'is-active is-primary' : ''} onClick={() => setTab(item.id)}>
            <span aria-hidden="true"><UiIcon name={item.icon} /></span><small>{item.label}</small>
          </button>
        ))}
      </nav>
      {message && <div className="toast" role="status">{message}</div>}
      {!state.onboardingCompleted && <Onboarding state={state} setState={setState} setTab={setTab} copy={copy} step={onboardingStep} setStep={setOnboardingStep} />}
    </div>
  );
}

function LanguageMenu({
  language,
  setLanguage,
  copy,
}: {
  language: Language;
  setLanguage: (language: Language) => void;
  copy: ReturnType<typeof copyFor>;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="language-menu" ref={menuRef}>
      <button
        className="language-switch"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={copy.languageAria}
        aria-expanded={open}
        title={copy.languageAria}
      >
        <LanguageIcon />
      </button>
      {open && (
        <div className="language-menu__list" role="menu" aria-label={copy.languageAria}>
          {languageOptions.map((option) => (
            <button
              key={option.code}
              type="button"
              role="menuitemradio"
              aria-checked={language === option.code}
              className={language === option.code ? 'is-active' : undefined}
              onClick={() => {
                setLanguage(option.code);
                setOpen(false);
              }}
            >
              <LanguageFlag code={option.code} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LanguageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18" />
    </svg>
  );
}

function LanguageFlag({ code }: { code: Language }) {
  const flags: Record<Language, string> = {
    cs: '🇨🇿',
    en: '🇬🇧',
    ua: '🇺🇦',
    fr: '🇫🇷',
    de: '🇩🇪',
    es: '🇪🇸',
  };

  return <span className="language-flag" aria-hidden="true">{flags[code]}</span>;
}

function ThemeToggle({ language }: { language: Language }) {
  const copy = copyFor(language);
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const darkMode = theme === 'dark';
  const label = darkMode ? copy.themeLight : copy.themeDark;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(themeKey, theme);
    } catch {
      // A blocked localStorage must not prevent the UI from switching theme.
    }
  }, [theme]);

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(darkMode ? 'light' : 'dark')}
      aria-pressed={darkMode}
      aria-label={label}
      title={label}
    >
      {darkMode ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2" /><path d="M12 19.5v2" />
      <path d="m4.6 4.6 1.4 1.4" /><path d="m18 18 1.4 1.4" />
      <path d="M2.5 12h2" /><path d="M19.5 12h2" />
      <path d="m4.6 19.4 1.4-1.4" /><path d="m18 6 1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.6A7.8 7.8 0 0 1 9.4 4a8 8 0 1 0 10.6 10.6Z" />
    </svg>
  );
}

function Dashboard({
  state,
  language,
  onNavigate,
  onStartOperation,
}: {
  state: MiniState;
  language: Language;
  onNavigate: (tab: Tab) => void;
  onStartOperation: (type: MovementType) => void;
}) {
  const copy = copyFor(language);
  const totalUnits = state.balances.reduce((sum, row) => sum + row.quantity, 0);
  const lowStock = state.products.filter((product) => totalStock(state, product.id) < product.minimumStock);
  return (
    <div className="page dashboard-page">
      <section className="dashboard-hero">
        <div className="dashboard-hero__copy">
          <span className="eyebrow">{state.warehouseName || copy.warehousePlaceholder}</span>
          <h1>{copy.dashboardTitle}</h1>
          <p>{copy.dashboardIntro}</p>
        </div>
        <button type="button" className="scan-cta" onClick={() => onStartOperation('RECEIPT')}>
          <span className="scan-cta__icon"><UiIcon name="scan" /></span>
          <span><strong>{copy.scanNow}</strong><small>{copy.scanNowHint}</small></span>
          <span className="scan-cta__arrow" aria-hidden="true">→</span>
        </button>
      </section>

      <section className="metrics-grid">
        <Metric icon="product" label={copy.productsMetric} value={state.products.length} />
        <Metric icon="location" label={copy.locationsMetric} value={state.locations.length} />
        <Metric icon="stock" label={copy.unitsMetric} value={formatNumber(totalUnits, language)} />
        <Metric icon="issue" label={copy.lowStockMetric} value={lowStock.length} warning={lowStock.length > 0} />
      </section>

      <section className="quick-panel" aria-labelledby="quick-actions-title">
        <div className="section-heading">
          <div><span className="eyebrow">{copy.navOperations}</span><h2 id="quick-actions-title">{copy.quickActions}</h2></div>
          <button type="button" className="text-button" onClick={() => onNavigate('stock')}>{copy.openProducts} →</button>
        </div>
        <div className="quick-actions">
          {(['RECEIPT', 'ISSUE', 'MOVE', 'COUNT'] as MovementType[]).map((type) => (
            <button type="button" key={type} className={`quick-action quick-action--${type.toLocaleLowerCase()}`} onClick={() => onStartOperation(type)}>
              <span><UiIcon name={movementIcon(type)} /></span>
              <strong>{movementLabel(copy, type)}</strong>
              <small>{operationHint(copy, type)}</small>
            </button>
          ))}
        </div>
      </section>

      {state.products.length === 0 && state.locations.length === 0 && <div className="empty-callout"><UiIcon name="product" /><div><strong>{copy.startHintTitle}</strong><span>{copy.startHint}</span></div><button type="button" className="button button--secondary" onClick={() => onNavigate('stock')}>{copy.openProducts}</button></div>}
      <section className="two-column">
        <Card title={copy.lowStockTitle}>
          {lowStock.length === 0 ? <Empty text={copy.noLowStock} /> : (
            <div className="list-stack">{lowStock.map((product) => (
              <article key={product.id}><div><strong>{product.name}</strong><small>{product.sku}</small></div><b>{formatNumber(totalStock(state, product.id), language)} / {formatNumber(product.minimumStock, language)}</b></article>
            ))}</div>
          )}
        </Card>
        <Card title={copy.recentTitle}>
          {state.movements.length === 0 ? <Empty text={copy.noMovements} /> : (
            <MovementList state={state} language={language} movements={state.movements.slice(0, 6)} />
          )}
        </Card>
      </section>
    </div>
  );
}

function Stock({ state, setState, copy, notify }: {
  state: MiniState;
  setState: React.Dispatch<React.SetStateAction<MiniState>>;
  copy: ReturnType<typeof copyFor>;
  notify: (value: string) => void;
}) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [unit, setUnit] = useState('ks');
  const [minimumStock, setMinimumStock] = useState('0');
  const [categoryId, setCategoryId] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [locationName, setLocationName] = useState('');
  const [search, setSearch] = useState('');
  const [editingProduct, setEditingProduct] = useState<MiniProduct | null>(null);
  const [editingLocation, setEditingLocation] = useState<MiniLocation | null>(null);

  const products = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return state.products;
    return state.products.filter((product) => `${product.name} ${product.sku} ${product.barcode} ${state.categories.find(category=>category.id===product.categoryId)?.name??''}`.toLocaleLowerCase().includes(query));
  }, [search, state.products, state.categories]);

  const addProduct = (event: FormEvent) => {
    event.preventDefault();
    const normalizedSku = sku.trim().toUpperCase();
    const normalizedName = name.trim();
    const normalizedBarcode = barcode.trim();
    if (!normalizedSku || !normalizedName) return notify(copy.requiredFields);
    if (state.products.some((product) => product.sku.toUpperCase() === normalizedSku)) return notify(copy.duplicateSku);
    if (normalizedBarcode && state.products.some((product) => product.barcode === normalizedBarcode)) return notify(copy.duplicateBarcode);
    const now = new Date().toISOString();
    const product: MiniProduct = {
      id: createId(), sku: normalizedSku, name: normalizedName, barcode: normalizedBarcode,
      unit: unit.trim() || 'ks', minimumStock: Math.max(0, Number(minimumStock) || 0), categoryId: categoryId || null, createdAt: now, updatedAt: now,
    };
    setState((current) => ({ ...current, products: [...current.products, product], updatedAt: now }));
    setSku(''); setName(''); setBarcode(''); setMinimumStock('0'); setCategoryId('');
    notify(copy.productSaved);
  };

  const addLocation = (event: FormEvent) => {
    event.preventDefault();
    const code = locationCode.trim().toUpperCase();
    const name = locationName.trim();
    if (!code || !name) return notify(copy.requiredFields);
    if (state.locations.some((location) => location.code.toUpperCase() === code)) return notify(copy.duplicateLocation);
    const now = new Date().toISOString();
    setState((current) => ({ ...current, locations: [...current.locations, { id: createId(), code, name, createdAt: now }], updatedAt: now }));
    setLocationCode(''); setLocationName('');
    notify(copy.locationSaved);
  };

  const saveProductEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingProduct) return;
    try {
      setState(updateProduct(state, editingProduct.id, editingProduct));
      setEditingProduct(null);
      notify(copy.productSaved);
    } catch (error) {
      notify(stockError(copy, error));
    }
  };

  const saveLocationEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingLocation) return;
    try {
      setState(updateLocation(state, editingLocation.id, editingLocation));
      setEditingLocation(null);
      notify(copy.locationSaved);
    } catch (error) {
      notify(stockError(copy, error));
    }
  };

  const removeProduct = (product: MiniProduct) => {
    if (!window.confirm(copy.deleteProductConfirm)) return;
    try {
      setState(deleteProduct(state, product.id));
      notify(copy.saved);
    } catch (error) {
      notify(stockError(copy, error));
    }
  };

  const removeLocation = (location: MiniLocation) => {
    if (!window.confirm(copy.deleteLocationConfirm)) return;
    try {
      setState(deleteLocation(state, location.id));
      notify(copy.saved);
    } catch (error) {
      notify(stockError(copy, error));
    }
  };

  return (
    <div className="page">
      <PageHeader eyebrow={state.warehouseName || 'Aardvarkland'} title={copy.productsTitle} />
      {editingProduct && <Card title={copy.editProduct}>
        <form className="form-grid" onSubmit={saveProductEdit}>
          <Field label={copy.sku} required value={editingProduct.sku} onChange={(value) => setEditingProduct({ ...editingProduct, sku: value })} />
          <Field label={copy.productName} required value={editingProduct.name} onChange={(value) => setEditingProduct({ ...editingProduct, name: value })} />
          <Field label={copy.barcode} value={editingProduct.barcode} onChange={(value) => setEditingProduct({ ...editingProduct, barcode: value })} />
          <div className="split-fields"><Field label={copy.unit} value={editingProduct.unit} onChange={(value) => setEditingProduct({ ...editingProduct, unit: value })} /><Field label={copy.minimumStock} type="number" min="0" value={String(editingProduct.minimumStock)} onChange={(value) => setEditingProduct({ ...editingProduct, minimumStock: Number(value) })} /></div>
          <label>{copy.category}<select value={editingProduct.categoryId??''} onChange={e=>setEditingProduct({...editingProduct,categoryId:e.target.value||null})}><option value="">{copy.noCategory}</option>{state.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <div className="button-stack"><button className="button" type="submit">{copy.saveProduct}</button><button className="button button--secondary" type="button" onClick={() => setEditingProduct(null)}>{copy.cancel}</button></div>
        </form>
      </Card>}
      {editingLocation && <Card title={copy.editLocation}>
        <form className="form-grid" onSubmit={saveLocationEdit}>
          <Field label={copy.locationCode} required value={editingLocation.code} onChange={(value) => setEditingLocation({ ...editingLocation, code: value })} />
          <Field label={copy.locationName} required value={editingLocation.name} onChange={(value) => setEditingLocation({ ...editingLocation, name: value })} />
          <div className="button-stack"><button className="button" type="submit">{copy.saveLocation}</button><button className="button button--secondary" type="button" onClick={() => setEditingLocation(null)}>{copy.cancel}</button></div>
        </form>
      </Card>}
      <section className="two-column forms-row">
        <Card title={copy.addProduct}>
          <form className="form-grid" onSubmit={addProduct}>
            <Field label={copy.sku} required value={sku} onChange={setSku} />
            <Field label={copy.productName} required value={name} onChange={setName} />
            <Field label={copy.barcode} value={barcode} onChange={setBarcode} />
            <div className="split-fields"><Field label={copy.unit} value={unit} onChange={setUnit} /><Field label={copy.minimumStock} type="number" min="0" value={minimumStock} onChange={setMinimumStock} /></div>
            <label>{copy.category}<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">{copy.noCategory}</option>{state.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <button className="button" type="submit">{copy.saveProduct}</button>
          </form>
          <form className="inline-form" onSubmit={e=>{e.preventDefault();const value=categoryName.trim();if(!value)return;const now=new Date().toISOString();setState(s=>({...s,categories:[...s.categories,{id:createId(),name:value,createdAt:now}],updatedAt:now}));setCategoryName('');notify(copy.categorySaved)}}><Field label={copy.newCategory} value={categoryName} onChange={setCategoryName}/><button className="button button--secondary" type="submit">{copy.addCategory}</button></form>
        </Card>
        <Card title={copy.locationsTitle}>
          <form className="form-grid" onSubmit={addLocation}>
            <Field label={copy.locationCode} required value={locationCode} onChange={setLocationCode} />
            <Field label={copy.locationName} required value={locationName} onChange={setLocationName} />
            <button className="button" type="submit">{copy.saveLocation}</button>
          </form>
          <div className="location-chips">
            {state.locations.length === 0 ? <Empty text={copy.noLocations} /> : state.locations.map((location) => <span key={location.id}><b>{location.code}</b>{location.name}<button type="button" className="chip-action" onClick={() => setEditingLocation({ ...location })}>{copy.edit}</button><button type="button" className="chip-action chip-action--danger" onClick={() => removeLocation(location)}>{copy.delete}</button></span>)}
          </div>
        </Card>
      </section>
      <Card title={copy.productsTitle}>
        <label className="search-box"><UiIcon name="search" /><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.search} /></label>
        {products.length === 0 ? <Empty text={copy.noProducts} /> : (
          <><div className="table-wrap product-table"><table><thead><tr><th>{copy.sku}</th><th>{copy.productName}</th><th>{copy.barcode}</th><th>{copy.totalStock}</th><th>{copy.locationsTitle}</th><th aria-label={copy.edit}>{copy.edit}</th></tr></thead>
            <tbody>{products.map((product) => {
              const total = totalStock(state, product.id);
              return <tr key={product.id} className={total < product.minimumStock ? 'is-warning' : ''}><td><b>{product.sku}</b></td><td>{product.name}<small>{product.unit} · min. {product.minimumStock}{product.categoryId?` · ${state.categories.find(c=>c.id===product.categoryId)?.name??''}`:''}</small></td><td>{product.barcode || '—'}</td><td><strong>{total}</strong></td><td>{state.locations.map((location) => {
                const quantity = stockAt(state, product.id, location.id);
                return quantity ? <span className="balance-chip" key={location.id}>{location.code}: {quantity}</span> : null;
              })}</td><td><button type="button" className="chip-action" onClick={() => setEditingProduct({ ...product })}>{copy.edit}</button><button type="button" className="chip-action chip-action--danger" onClick={() => removeProduct(product)}>{copy.delete}</button></td></tr>;
            })}</tbody>
          </table></div><div className="product-mobile-list">{products.map((product) => {
            const total = totalStock(state, product.id);
            return <article key={product.id} className={total < product.minimumStock ? 'is-warning' : ''}>
              <div className="product-mobile-list__head"><span className="product-symbol"><UiIcon name="product" /></span><div><strong>{product.name}</strong><small>{product.sku} · {product.barcode || copy.barcode}</small></div><b>{total}<small>{product.unit}</small></b></div>
              <div className="product-mobile-list__locations">{state.locations.map((location) => { const amount = stockAt(state, product.id, location.id); return amount ? <span className="balance-chip" key={location.id}>{location.code}: {amount}</span> : null; })}</div>
              <div className="product-mobile-list__actions"><button type="button" className="button button--secondary button--small" onClick={() => setEditingProduct({ ...product })}>{copy.edit}</button><button type="button" className="button button--ghost-danger button--small" onClick={() => removeProduct(product)}>{copy.delete}</button></div>
            </article>;
          })}</div></>
        )}
      </Card>
    </div>
  );
}

function Operations({ state, setState, copy, notify, initialType }: {
  state: MiniState;
  setState: React.Dispatch<React.SetStateAction<MiniState>>;
  copy: ReturnType<typeof copyFor>;
  notify: (value: string) => void;
  initialType: MovementType;
}) {
  const [type, setType] = useState<MovementType>(initialType);
  const [productId, setProductId] = useState('');
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [batchId, setBatchId] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [scan, setScan] = useState('');
  const [camera, setCamera] = useState(false);
  const selectedProduct = state.products.find((product) => product.id === productId);

  useEffect(() => {
    setType(initialType);
  }, [initialType]);

  const resolveScan = useCallback((raw: string) => {
    const value = raw.trim().toLocaleLowerCase();
    if (!value) return;
    const product = state.products.find((item) => item.sku.toLocaleLowerCase() === value || item.barcode.toLocaleLowerCase() === value);
    if (!product) return notify(copy.scanNotFound);
    setProductId(product.id);
    setScan(product.barcode || product.sku);
  }, [copy.scanNotFound, notify, state.products]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const updated = applyMovement(state, {
        type, productId, fromLocationId, toLocationId, quantity: Number(quantity), note, batchId, lotNumber, expiryDate,
      });
      setState(updated);
      setQuantity(type === 'COUNT' ? '0' : '1');
      setNote(''); setScan('');
      notify(copy.movementSaved);
    } catch (error) {
      notify(movementError(copy, error));
    }
  };

  return (
    <div className="page operation-page">
      <PageHeader eyebrow={state.warehouseName || 'Aardvarkland'} title={copy.operationsTitle} />
      <Card title={copy.scanLabel} className="scan-card">
        <p className="muted scan-hint">{copy.mobileScanHint}</p>
        <div className="scan-row">
          <label className="scan-input"><UiIcon name="search" /><input autoFocus value={scan} placeholder={copy.scanPlaceholder} onChange={(event) => setScan(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); resolveScan(scan); }
          }} /></label>
          <button type="button" className="button button--secondary" onClick={() => resolveScan(scan)}><UiIcon name="search" />{copy.findProduct}</button>
          <button type="button" className="button button--accent" onClick={() => setCamera(true)}><UiIcon name="camera" />{copy.cameraOpen}</button>
        </div>
        {selectedProduct && <div className="selected-product"><span><UiIcon name="product" /></span><div><small>{copy.selectedProduct}</small><strong>{selectedProduct.name}</strong><b>{selectedProduct.sku}{selectedProduct.barcode ? ` · ${selectedProduct.barcode}` : ''}</b></div><strong>{totalStock(state, selectedProduct.id)} {selectedProduct.unit}</strong></div>}
      </Card>
      <Card title={copy.operationsTitle}>
        <form className="operation-form" onSubmit={submit}>
          <fieldset className="operation-types"><legend>{copy.movementType}</legend><div>
            {(['RECEIPT', 'ISSUE', 'MOVE', 'COUNT'] as MovementType[]).map((value) => <button type="button" key={value} aria-pressed={type === value} className={type === value ? 'is-active' : ''} onClick={() => setType(value)}><UiIcon name={movementIcon(value)} /><span>{movementLabel(copy, value)}</span></button>)}
          </div></fieldset>
          <label>{copy.product}<select value={productId} required onChange={(event) => setProductId(event.target.value)}><option value="">{copy.chooseProduct}</option>{state.products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></label>
          {(type === 'ISSUE' || type === 'MOVE') && <label>{copy.fromLocation}<select value={fromLocationId} required onChange={(event) => setFromLocationId(event.target.value)}><option value="">{copy.chooseLocation}</option>{state.locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label>}
          {(type === 'RECEIPT' || type === 'MOVE' || type === 'COUNT') && <label>{copy.toLocation}<select value={toLocationId} required onChange={(event) => setToLocationId(event.target.value)}><option value="">{copy.chooseLocation}</option>{state.locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label>}
          <label>{copy.quantity}<input type="number" min={type === 'COUNT' ? '0' : '0.0001'} step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
          {type==='RECEIPT'&&<><label>{copy.lotNumber}<input value={lotNumber} onChange={e=>setLotNumber(e.target.value)}/></label><label>{copy.expiryDate}<input type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)}/></label></>}
          {(type==='ISSUE'||type==='MOVE')&&<label>{copy.chooseBatch}<select value={batchId} onChange={e=>setBatchId(e.target.value)}><option value="">{copy.noBatch}</option>{state.batches.filter(b=>b.productId===productId&&b.locationId===fromLocationId&&b.quantity>0).map(b=><option key={b.id} value={b.id}>{b.lotNumber||'—'} · {b.expiryDate||'—'} · {b.quantity}</option>)}</select></label>}
          <label className="wide-field">{copy.note}<input value={note} placeholder={copy.notePlaceholder} onChange={(event) => setNote(event.target.value)} /></label>
          <button className="button wide-field" type="submit" disabled={!state.products.length || !state.locations.length}>{copy.submitMovement}</button>
        </form>
      </Card>
      {camera && <Suspense fallback={<div className="camera-backdrop"><div className="camera-loading" role="status"><UiIcon name="camera" /><span>{copy.cameraOpen}</span></div></div>}><CameraScanner hint={copy.cameraHint} denied={copy.cameraDenied} onClose={() => setCamera(false)} onResult={(value) => { setCamera(false); setScan(value); resolveScan(value); }} /></Suspense>}
    </div>
  );
}

function History({ state, language, copy }: { state: MiniState; language: Language; copy: ReturnType<typeof copyFor> }) {
  const [filter, setFilter] = useState<'ALL' | MovementType>('ALL');
  const [page, setPage] = useState(0);
  const movements = filter === 'ALL' ? state.movements : state.movements.filter((movement) => movement.type === filter);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(movements.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleMovements = movements.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return (
    <div className="page">
      <PageHeader eyebrow={state.warehouseName || 'Aardvarkland'} title={copy.historyTitle} />
      <Card title={copy.historyTitle}>
        <select className="history-filter" value={filter} onChange={(event) => { setFilter(event.target.value as 'ALL' | MovementType); setPage(0); }}>
          <option value="ALL">{copy.allTypes}</option>
          {(['RECEIPT', 'ISSUE', 'MOVE', 'COUNT'] as MovementType[]).map((type) => <option key={type} value={type}>{movementLabel(copy, type)}</option>)}
        </select>
        {movements.length === 0 ? <Empty text={copy.noMovements} /> : <>
          <p className="muted">{copy.historyPage} {currentPage + 1} {copy.pageOf} {pageCount} · {movements.length}</p>
          <MovementList state={state} language={language} movements={visibleMovements} />
          <div className="pagination"><button type="button" className="button button--secondary" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>{copy.previousPage}</button><button type="button" className="button button--secondary" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>{copy.nextPage}</button></div>
        </>}
      </Card>
    </div>
  );
}

function DataTools({ state, setState, setWarehouseDraft, storageBackend, copy, notify }: {
  state: MiniState;
  setState: React.Dispatch<React.SetStateAction<MiniState>>;
  setWarehouseDraft: (value: string) => void;
  storageBackend: StorageBackend;
  copy: ReturnType<typeof copyFor>;
  notify: (value: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const spreadsheetRef = useRef<HTMLInputElement | null>(null);
  const [pin,setPinValue]=useState('');
  const [hasLock,setHasLock]=useState(Boolean(readLock()));
  const [hasNotifications,setHasNotifications]=useState(notificationsEnabled());
  const exportBackup = async () => {
    const lastBackupAt = new Date().toISOString();
    const backup = { ...state, lastBackupAt };
    try {
      await downloadBackup(JSON.stringify(backup, null, 2), `aardvarkland-mini-${new Date().toISOString().slice(0, 10)}.json`);
      setState(backup);
      notify(copy.backupRecorded);
    } catch {
      notify(copy.invalidBackup);
    }
  };
  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const restored = parseMiniBackup(JSON.parse(await file.text()));
      setState(restored); setWarehouseDraft(restored.warehouseName); notify(copy.backupImported);
    } catch { notify(copy.invalidBackup); }
    if (fileRef.current) fileRef.current.value = '';
  };
  return (
    <div className="page">
      <PageHeader eyebrow={state.warehouseName || 'Aardvarkland'} title={copy.dataTitle} />
      <section className="two-column">
        <Card title={copy.dataTitle}>
          <p className="muted">{copy.backupDescription}</p>
          <div className="button-stack">
            <button type="button" className="button" onClick={exportBackup}>{copy.exportBackup}</button>
            <button type="button" className="button button--secondary" onClick={() => fileRef.current?.click()}>{copy.importBackup}</button>
            <input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => void importBackup(event.target.files?.[0])} />
          </div>
          <p className="warning-copy">{copy.importWarning}</p>
          <hr />
          <div className="button-stack"><button type="button" className="button" onClick={()=>void exportWorkbook(state)}>{copy.exportExcel}</button><button type="button" className="button button--secondary" onClick={()=>spreadsheetRef.current?.click()}>{copy.importSpreadsheet}</button><button type="button" className="button button--secondary" onClick={()=>void downloadImportTemplate()}>{copy.downloadTemplate}</button><input ref={spreadsheetRef} hidden type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const next=await importProductsFile(state,file);setState(next);notify(copy.importSuccess)}catch{notify(copy.importInvalid)}e.target.value=''}}/></div>
        </Card>
        <Card title={copy.localOnly}>
          <p className="muted"><strong>{copy.storageStatus}:</strong> {storageBackend === 'indexeddb' ? copy.storageIndexedDb : copy.storageLocalStorage}</p>
          <p className="muted"><strong>{copy.lastBackup}:</strong> {state.lastBackupAt ? new Date(state.lastBackupAt).toLocaleString() : copy.never}</p>
          <div className="button-stack">
            <button type="button" className="button button--secondary" onClick={async () => {
              const granted = await navigator.storage?.persist?.() ?? false;
              notify(granted ? copy.storageGranted : copy.storageNotGranted);
            }}>{copy.persistentStorage}</button>
            <button type="button" className="button button--danger" onClick={() => {
              if (!window.confirm(copy.clearConfirm)) return;
              const empty = emptyMiniState();
              setState(empty); setWarehouseDraft(''); notify(copy.dataCleared);
            }}>{copy.clearData}</button>
          </div>
        </Card>
        <Card title={copy.lowStockNotifications}><div className="button-stack"><button type="button" className="button button--secondary" onClick={async()=>{if(hasNotifications){disableNotifications();setHasNotifications(false)}else{const ok=await enableNotifications();setHasNotifications(ok);notify(ok?copy.notificationsEnabled:copy.notificationsDenied)}}}>{hasNotifications?copy.disableNotifications:copy.enableNotifications}</button></div></Card>
        <Card title={copy.appLock}><Field label={copy.pinLabel} type="password" value={pin} onChange={setPinValue}/><div className="button-stack"><button type="button" className="button" onClick={async()=>{try{await setPin(pin);setPinValue('');setHasLock(true);notify(copy.saved)}catch{notify(copy.requiredFields)}}}>{copy.setPin}</button>{hasLock&&<button type="button" className="button button--secondary" onClick={()=>{disablePin();setHasLock(false);notify(copy.saved)}}>{copy.disablePin}</button>}</div></Card>
      </section>
    </div>
  );
}

function Reports({state,copy}:{state:MiniState;copy:ReturnType<typeof copyFor>}){
  const today=new Date().toISOString().slice(0,10);const first=`${today.slice(0,8)}01`;const[from,setFrom]=useState(first);const[to,setTo]=useState(today);const rows=reportRows(state,from,to);const low=state.products.filter(p=>totalStock(state,p.id)<p.minimumStock);const expiryLimit=new Date(Date.now()+30*86400000).toISOString().slice(0,10);const expiring=state.batches.filter(b=>b.expiryDate&&b.expiryDate<=expiryLimit&&b.quantity>0);
  return <div className="page"><PageHeader eyebrow={state.warehouseName||'Aardvarkland'} title={copy.reportsTitle}/><Card title={copy.reportsTitle}><div className="split-fields"><Field label={copy.fromDate} type="date" value={from} onChange={setFrom}/><Field label={copy.toDate} type="date" value={to} onChange={setTo}/></div><div className="metrics-grid"><Metric icon="history" label={copy.periodMovements} value={rows.length}/><Metric icon="stock" label={copy.currentStock} value={state.balances.reduce((a,b)=>a+b.quantity,0)}/><Metric icon="issue" label={copy.belowMinimum} value={low.length} warning={low.length>0}/><Metric icon="count" label={copy.expiringSoon} value={expiring.length} warning={expiring.length>0}/></div><div className="button-stack"><button className="button" type="button" onClick={()=>void exportReportCsv(state,from,to)}>{copy.exportCsv}</button><button className="button button--secondary" type="button" onClick={()=>void exportReportPdf(state,from,to)}>{copy.exportPdf}</button></div></Card><Card title={copy.batches}>{expiring.length? <div className="list-stack">{expiring.map(b=><article key={b.id}><div><strong>{state.products.find(p=>p.id===b.productId)?.name}</strong><small>{b.lotNumber||'—'} · {b.expiryDate}</small></div><b>{b.quantity}</b></article>)}</div>:<Empty text="—"/>}</Card></div>
}

function LockScreen({copy,onUnlock}:{copy:ReturnType<typeof copyFor>;onUnlock:()=>void}){const[pin,setPinValue]=useState('');const[error,setError]=useState('');return <div className="modal-backdrop"><form className="modal-card" onSubmit={async e=>{e.preventDefault();if(await verifyPin(pin))onUnlock();else{setError(copy.wrongPin);setPinValue('')}}}><img src="./icons/icon-192.png" alt=""/><h1>{copy.lockedTitle}</h1><Field label={copy.pinLabel} type="password" value={pin} onChange={setPinValue}/>{error&&<p className="warning-copy">{error}</p>}<button className="button" type="submit">{copy.unlock}</button></form></div>}

function Onboarding({state,setState,setTab,copy,step,setStep}:{state:MiniState;setState:React.Dispatch<React.SetStateAction<MiniState>>;setTab:(tab:Tab)=>void;copy:ReturnType<typeof copyFor>;step:number;setStep:(v:number)=>void}){const titles=[copy.onboardingWarehouse,copy.onboardingLocation,copy.onboardingProducts,copy.onboardingReceipt];const finish=()=>setState(s=>({...s,onboardingCompleted:true,updatedAt:new Date().toISOString()}));return <div className="modal-backdrop"><section className="modal-card"><img src="./icons/icon-192.png" alt=""/><span className="eyebrow">{copy.onboardingTitle} · {step+1}/4</span><h1>{titles[step]}</h1><p className="muted">{step===0?copy.warehousePlaceholder:step===1?copy.addLocation:step===2?copy.importSpreadsheet:copy.receiptHint}</p><div className="button-stack">{step<3?<button className="button" type="button" onClick={()=>{if(step===0)setTab('dashboard');else if(step<3)setTab('stock');setStep(step+1)}}>{copy.next}</button>:<button className="button" type="button" onClick={()=>{setTab('operations');finish()}}>{copy.finish}</button>}<button className="button button--secondary" type="button" onClick={finish}>{copy.skipOnboarding}</button></div></section></div>}

function MovementList({ state, language, movements }: { state: MiniState; language: Language; movements: MiniState['movements'] }) {
  const copy = copyFor(language);
  return <div className="movement-list">{movements.map((movement) => {
    const product = state.products.find((item) => item.id === movement.productId);
    const from = state.locations.find((item) => item.id === movement.fromLocationId);
    const to = state.locations.find((item) => item.id === movement.toLocationId);
    return <article key={movement.id}><div><span>{movementLabel(copy, movement.type)}</span><strong>{product?.name ?? product?.sku ?? '—'}</strong><small>{[from?.code, to?.code].filter(Boolean).join(' → ') || '—'}{movement.note ? ` · ${movement.note}` : ''}</small></div><div><b>{movement.type === 'COUNT' ? `=${movement.quantity}` : movement.type === 'MOVE' ? movement.quantity : signed(movement.delta)}</b><time>{new Intl.DateTimeFormat(locales[language], { dateStyle: 'short', timeStyle: 'short' }).format(new Date(movement.createdAt))}</time></div></article>;
  })}</div>;
}

function PageHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <header className="page-header"><span>{eyebrow}</span><h1>{title}</h1></header>;
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`card ${className}`.trim()}><h2>{title}</h2>{children}</section>;
}

function Metric({ icon, label, value, warning = false }: { icon: IconName; label: string; value: string | number; warning?: boolean }) {
  return <article className={`metric ${warning ? 'is-warning' : ''}`}><span className="metric__icon"><UiIcon name={icon} /></span><div><span>{label}</span><strong>{value}</strong></div></article>;
}

function Empty({ text }: { text: string }) { return <p className="empty">{text}</p>; }

function Field({ label, value, onChange, required = false, type = 'text', min }: {
  label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string; min?: string;
}) {
  return <label>{label}<input type={type} min={min} required={required} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function movementError(copy: ReturnType<typeof copyFor>, error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const errors: Record<string, string> = {
    INVALID_QUANTITY: copy.invalidQuantity,
    PRODUCT_REQUIRED: copy.chooseProduct,
    FROM_REQUIRED: copy.fromRequired,
    TO_REQUIRED: copy.toRequired,
    SAME_LOCATION: copy.sameLocation,
    INSUFFICIENT_STOCK: copy.insufficientStock,
  };
  return errors[code] ?? copy.requiredFields;
}

function stockError(copy: ReturnType<typeof copyFor>, error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const errors: Record<string, string> = {
    INVALID_PRODUCT: copy.requiredFields,
    INVALID_LOCATION: copy.requiredFields,
    DUPLICATE_SKU: copy.duplicateSku,
    DUPLICATE_BARCODE: copy.duplicateBarcode,
    DUPLICATE_LOCATION: copy.duplicateLocation,
    PRODUCT_IN_USE: copy.productInUse,
    LOCATION_IN_USE: copy.locationInUse,
  };
  return errors[code] ?? copy.requiredFields;
}

function readLanguage(): Language {
  const value = window.localStorage.getItem(languageKey);
  return languageOptions.some((option) => option.code === value) ? value as Language : 'cs';
}

function signed(value: number): string { return value > 0 ? `+${value}` : String(value); }
function formatNumber(value: number, language: Language): string { return new Intl.NumberFormat(locales[language], { maximumFractionDigits: 3 }).format(value); }

function movementIcon(type: MovementType): IconName {
  return { RECEIPT: 'receipt', ISSUE: 'issue', MOVE: 'move', COUNT: 'count' }[type] as IconName;
}

function operationHint(copy: ReturnType<typeof copyFor>, type: MovementType): string {
  return { RECEIPT: copy.receiptHint, ISSUE: copy.issueHint, MOVE: copy.moveHint, COUNT: copy.countHint }[type];
}

function UiIcon({ name }: { name: IconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'dashboard': return <svg viewBox="0 0 24 24" {...common}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="10.5" width="7" height="10" rx="1.5" /></svg>;
    case 'stock': return <svg viewBox="0 0 24 24" {...common}><path d="m4 7.5 8-4 8 4-8 4-8-4Z" /><path d="M4 7.5v9l8 4 8-4v-9" /><path d="M12 11.5v9" /></svg>;
    case 'scan': return <svg viewBox="0 0 24 24" {...common}><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M7 12h10M8 9v6M11 9v6M14 9v6M17 9v6" /></svg>;
    case 'history': return <svg viewBox="0 0 24 24" {...common}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" /><path d="M4.5 4.5V9H9" /><path d="M12 8v4l3 2" /></svg>;
    case 'reports': return <svg viewBox="0 0 24 24" {...common}><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7" /><path d="M3 20.5h18" /></svg>;
    case 'data': return <svg viewBox="0 0 24 24" {...common}><ellipse cx="12" cy="5.5" rx="7.5" ry="3" /><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" /><path d="M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" /></svg>;
    case 'receipt': return <svg viewBox="0 0 24 24" {...common}><path d="M12 3v11" /><path d="m7.5 9.5 4.5 4.5 4.5-4.5" /><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" /></svg>;
    case 'issue': return <svg viewBox="0 0 24 24" {...common}><path d="M12 21V10" /><path d="m7.5 14.5 4.5-4.5 4.5 4.5" /><path d="M4.5 8.5v-3a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3" /></svg>;
    case 'move': return <svg viewBox="0 0 24 24" {...common}><path d="M4 8h14" /><path d="m14 4 4 4-4 4" /><path d="M20 16H6" /><path d="m10 12-4 4 4 4" /></svg>;
    case 'count': return <svg viewBox="0 0 24 24" {...common}><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M9 8h6M9 12h2M14 12h1M9 16h2M14 16h1" /></svg>;
    case 'search': return <svg viewBox="0 0 24 24" {...common}><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 4.5 4.5" /></svg>;
    case 'camera': return <svg viewBox="0 0 24 24" {...common}><path d="M5 7h3l1.3-2h5.4L16 7h3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="3.5" /></svg>;
    case 'database': return <svg viewBox="0 0 24 24" {...common}><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>;
    case 'location': return <svg viewBox="0 0 24 24" {...common}><path d="M12 21s6-5.2 6-10.5a6 6 0 1 0-12 0C6 15.8 12 21 12 21Z" /><circle cx="12" cy="10.5" r="2" /></svg>;
    case 'product': return <svg viewBox="0 0 24 24" {...common}><path d="M5 6.5h9l5 5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" /><path d="M14 6.5v5h5M7.5 14h6" /></svg>;
    default: return null;
  }
}
