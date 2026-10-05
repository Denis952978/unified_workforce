import { JSDOM } from 'jsdom';
import { OFFICE } from './helpers';

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const downloads: { name: string; size: number; type: string }[] = [];
export const kit = { base: '' };

export class Browser {
  dom!: JSDOM; cookies = new Map<string, string>();
  constructor(public ip = OFFICE) {}
  async fetch(url: string, opts: any = {}) {
    const headers = { ...(opts.headers || {}), 'X-Forwarded-For': this.ip, Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    const r = await fetch(new URL(url, kit.base), { ...opts, headers });
    for (const c of (r.headers as any).getSetCookie?.() || []) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); const val = v.join('='); if (/Expires=Thu, 01 Jan 1970/i.test(c) || val === '') this.cookies.delete(k); else this.cookies.set(k, val); }
    return r;
  }
  async open() {
    const html = await (await this.fetch('/')).text(); const js = await (await this.fetch('/app.js')).text();
    const self = this;
    this.dom = new JSDOM(html.replace('<script src="/app.js"></script>', '<script>' + js.replace(/<\/script/g, '<\\/script') + '</script>'), { url: kit.base + '/', runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(w: any) {
        w.fetch = (u: string, o: any) => self.fetch(u, o); w.scrollTo = () => {};
        w.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; w.HTMLDialogElement.prototype.close = function () { this.open = false; };
        w.URL.createObjectURL = (b: any) => { downloads.push({ name: '', size: b.size, type: b.type }); return 'blob:x'; }; w.URL.revokeObjectURL = () => {};
        w.HTMLAnchorElement.prototype.click = function () { if (this.download) downloads[downloads.length - 1].name = this.download; };
        w.addEventListener('error', (e: any) => console.log('PAGE ERROR', e.message));
      } });
    await this.until(() => !/Loading…|Preparing the workforce/.test(this.text()));
    return this;
  }
  get w(): any { return this.dom.window; }
  $(s: string) { return this.w.document.querySelector(s); }
  $$(s: string) { return [...this.w.document.querySelectorAll(s)]; }
  text() { return (this.$('#main') || this.$('#root')).textContent.replace(/\s+/g, ' '); }
  toast() { return this.$('#toast').textContent.trim(); }
  dialog() { return this.$('#dlg').textContent.replace(/\s+/g, ' '); }
  fill(form: any, vals: Record<string, any>) { for (const [k, v] of Object.entries(vals)) { const el = form.querySelector(`[name="${k}"]`); if (!el) throw new Error('no field ' + k); if (el.type === 'checkbox') el.checked = v; else el.value = v; } }
  submit(form: any) { form.dispatchEvent(new this.w.Event('submit', { bubbles: true, cancelable: true })); }
  click(sel: any) { const el = typeof sel === 'string' ? this.$(sel) : sel; if (!el) throw new Error('missing ' + sel); el.dispatchEvent(new this.w.MouseEvent('click', { bubbles: true })); }
  go(route: string, params = '{}') { this.w.eval(`go('${route}', ${params})`); }
  async settle() { await this.w.eval('sync.queue'); await sleep(30); }
  async refresh() { await this.w.eval('loadState().then(() => { assemble(sync.raw); render(true); })'); }
  async until(fn: () => boolean, ms = 6000) { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out; page says: ' + this.text().slice(0, 300) + ' | toast: ' + this.toast()); await sleep(25); } }
  async signIn(email: string, password: string) { await this.open(); const f = this.$('form[data-auth=signin]'); this.fill(f, { email, pw: password }); this.submit(f); await this.until(() => !!this.$('.nav')); }
}
