/* Skies Weather — an iPhone-Weather-style web app.
 * Data: Open-Meteo (forecast, ensemble for 30-day outlook, geocoding). No API key needed.
 */
(() => {
  'use strict';

  const API = {
    forecast: 'https://api.open-meteo.com/v1/forecast',
    ensemble: 'https://ensemble-api.open-meteo.com/v1/ensemble',
    geocode: 'https://geocoding-api.open-meteo.com/v1/search',
    reverse: 'https://api.bigdatacloud.net/data/reverse-geocode-client',
  };
  const DEFAULT_LOC = { name: 'Cupertino', admin: 'California', country: 'United States', lat: 37.323, lon: -122.032 };

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const state = {
    unit: store.get('wx.unit', 'C'),
    saved: store.get('wx.saved', []),          // [{name, admin, country, lat, lon}]
    current: null,                            // device location {name, lat, lon, isCurrent}
    index: 0,                                 // 0 = current location, 1.. = saved
    data: null,
    ext: null,                                // 30-day ensemble daily data
    range: 10,
    loc: null,
  };

  // ---------------------------------------------------------------- helpers
  const toUnit = (c) => (c == null ? null : state.unit === 'F' ? c * 9 / 5 + 32 : c);
  const T = (c) => (c == null || Number.isNaN(c) ? '--' : Math.round(toUnit(c)) + '°');
  const windU = (k) => (state.unit === 'F' ? `${Math.round(k * 0.621371)} mph` : `${Math.round(k)} km/h`);
  const pad = (n) => String(n).padStart(2, '0');
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "2026-11-21" -> Date treated as UTC for weekday maths
  const ymd = (s) => new Date(s.slice(0, 10) + 'T00:00:00Z');
  const hourOf = (iso) => parseInt(iso.slice(11, 13), 10);
  const fmtHour = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'AM' : 'PM');
  const fmtClock = (iso) => { const h = hourOf(iso), m = iso.slice(14, 16); return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`; };
  // Location-local "now" as an ISO-like string "YYYY-MM-DDTHH:MM"
  const localNow = (offsetSec) => {
    const d = new Date(Date.now() + offsetSec * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };

  async function getJSON(url, params) {
    const u = new URL(url);
    Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u.toString());
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // ------------------------------------------------------- weather codes
  const WMO = {
    0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Cloudy',
    45: 'Fog', 48: 'Freezing Fog',
    51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle', 56: 'Freezing Drizzle', 57: 'Freezing Drizzle',
    61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain', 66: 'Freezing Rain', 67: 'Freezing Rain',
    71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow Grains',
    80: 'Showers', 81: 'Showers', 82: 'Heavy Showers', 85: 'Snow Showers', 86: 'Heavy Snow Showers',
    95: 'Thunderstorms', 96: 'Thunderstorms', 99: 'Severe Thunderstorms',
  };
  const kind = (c) => {
    if (c == null) return 'cloud';
    if (c === 0 || c === 1) return 'clear';
    if (c === 2) return 'partly';
    if (c === 3) return 'cloud';
    if (c === 45 || c === 48) return 'fog';
    if (c >= 51 && c <= 57) return 'drizzle';
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if (c >= 95) return 'storm';
    return 'cloud';
  };
  const condText = (code, wind) => {
    const t = WMO[code] || 'Cloudy';
    return wind >= 40 && (code <= 3) ? 'Windy' : t;
  };

  // ---------------------------------------------------------------- icons
  const SUN = '<circle cx="16" cy="16" r="6.5" fill="#FFD43B"/><g stroke="#FFD43B" stroke-width="2.4" stroke-linecap="round"><path d="M16 3v3M16 26v3M3 16h3M26 16h3M6.8 6.8l2.1 2.1M23.1 23.1l2.1 2.1M6.8 25.2l2.1-2.1M23.1 8.9l2.1-2.1"/></g>';
  const MOON = '<path d="M20.5 4.5a11 11 0 1 0 7 17.6A9 9 0 0 1 20.5 4.5z" fill="#F4F1D0"/>';
  const CLOUD = (fill = '#fff', dx = 0, dy = 0) => `<path transform="translate(${dx} ${dy})" d="M9 26h15a6 6 0 0 0 .6-11.97A8 8 0 0 0 9.3 15.2 5.4 5.4 0 0 0 9 26z" fill="${fill}"/>`;
  const SMALL_SUN = '<g transform="translate(-3 -4) scale(.75)">' + SUN + '</g>';
  const SMALL_MOON = '<g transform="translate(-2 -3) scale(.7)">' + MOON + '</g>';
  const DROPS = '<g stroke="#5BB8FF" stroke-width="2.2" stroke-linecap="round"><path d="M11 27l-1.5 3.5M17 27l-1.5 3.5M23 27l-1.5 3.5"/></g>';
  const DRIZ = '<g fill="#5BB8FF"><circle cx="11" cy="29" r="1.3"/><circle cx="17" cy="30" r="1.3"/><circle cx="23" cy="29" r="1.3"/></g>';
  const FLAKES = '<g fill="#fff"><circle cx="11" cy="29" r="1.7"/><circle cx="17" cy="30.5" r="1.7"/><circle cx="23" cy="29" r="1.7"/></g>';
  const BOLT = '<path d="M17 22l-4 6h3.5l-2 5 6-7.5h-3.6l2.2-3.5z" fill="#FFD43B"/>';
  const FOGL = '<g stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".9"><path d="M6 13h20M4 18h24M7 23h18"/></g>';
  const WIND = '<g fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"><path d="M4 12h15a3.5 3.5 0 1 0-3.5-3.5"/><path d="M4 18h21a3.5 3.5 0 1 1-3.5 3.5"/><path d="M4 24h10"/></g>';

  function icon(code, isDay = 1, wind = 0) {
    const k = kind(code);
    let g;
    const shifted = (inner) => `<g transform="translate(0 -4)">${inner}</g>`;
    switch (k) {
      case 'clear': g = wind >= 40 ? WIND : (isDay ? SUN : MOON); break;
      case 'partly': g = (isDay ? SMALL_SUN : SMALL_MOON) + CLOUD('#fff', 2, 1); break;
      case 'cloud': g = CLOUD('#e8edf3', -3, -3) + CLOUD('#fff', 2, 1); break;
      case 'fog': g = FOGL; break;
      case 'drizzle': g = shifted(CLOUD('#fff')) + DRIZ; break;
      case 'rain': g = shifted(CLOUD('#fff')) + DROPS; break;
      case 'snow': g = shifted(CLOUD('#fff')) + FLAKES; break;
      case 'storm': g = shifted(CLOUD('#e0e4ea')) + BOLT; break;
      default: g = CLOUD();
    }
    return `<svg viewBox="0 0 32 34" aria-hidden="true">${g}</svg>`;
  }
  const sunriseIcon = (up) => `<svg viewBox="0 0 32 34"><path d="M5 24h22" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M9 24a7 7 0 0 1 14 0" fill="#FFD43B"/><path d="M16 ${up ? '15V8m-3 3l3-3 3 3' : '8v7m-3-3l3 3 3-3'}" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // ---------------------------------------------------------------- scenes
  // Gradient + effects for the animated backdrop
  function sceneFor(code, isDay, wind, gust) {
    const k = kind(code);
    const windy = wind >= 30 || gust >= 55;
    const s = { top: '#2f7fd8', bottom: '#7ab6ee', sun: false, stars: false, clouds: 0, cloudShade: 1, rain: 0, snow: 0, lightning: false, fog: false, wind: windy, windSpeed: wind };
    const night = !isDay;
    switch (k) {
      case 'clear':
        Object.assign(s, night ? { top: '#070b1f', bottom: '#27365f', stars: true } : { top: '#2a74d0', bottom: '#79b8f0', sun: true });
        break;
      case 'partly':
        Object.assign(s, night ? { top: '#10162d', bottom: '#38456a', stars: true, clouds: 4, cloudShade: .45 } : { top: '#3b82cc', bottom: '#8cbbe6', sun: true, clouds: 4, cloudShade: 1 });
        break;
      case 'cloud':
        Object.assign(s, night ? { top: '#1b2230', bottom: '#454f61', clouds: 9, cloudShade: .4 } : { top: '#5d7790', bottom: '#a0b3c4', clouds: 9, cloudShade: .92 });
        break;
      case 'fog':
        Object.assign(s, night ? { top: '#2a3038', bottom: '#5b636c', fog: true, clouds: 3, cloudShade: .5 } : { top: '#8a97a1', bottom: '#c3cbd1', fog: true, clouds: 3, cloudShade: .95 });
        break;
      case 'drizzle':
      case 'rain':
        Object.assign(s, night ? { top: '#141b26', bottom: '#38434f' } : { top: '#4a5c6f', bottom: '#8597a6' },
          { clouds: 8, cloudShade: night ? .35 : .7, rain: k === 'drizzle' ? 0.35 : (code === 65 || code === 82 ? 1.4 : 0.85) });
        break;
      case 'snow':
        Object.assign(s, night ? { top: '#263042', bottom: '#5a687c' } : { top: '#8aa0b6', bottom: '#cfd9e3' },
          { clouds: 6, cloudShade: night ? .5 : .95, snow: code === 75 || code === 86 ? 1.4 : 0.8 });
        break;
      case 'storm':
        Object.assign(s, { top: night ? '#0e1219' : '#252b37', bottom: night ? '#2e3442' : '#4d5462', clouds: 10, cloudShade: .3, rain: 1.5, lightning: true });
        break;
    }
    if (windy && !s.rain && !s.snow) s.clouds = Math.max(s.clouds, 3);
    s.night = night;
    return s;
  }

  // ------------------------------------------------------- canvas effects
  const FX = (() => {
    const cv = $('fx');
    const ctx = cv.getContext('2d');
    let W = 0, H = 0, DPR = 1, scene = null, t0 = performance.now(), last = t0;
    let clouds = [], drops = [], flakes = [], stars = [], streaks = [], leaves = [], fogs = [], splashes = [];
    let flash = 0, bolt = null, nextBolt = 0, shooting = null;
    const sprites = {};

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = W * DPR; cv.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (scene) build();
    }

    function cloudSprite(seed) {
      if (sprites[seed]) return sprites[seed];
      const c = document.createElement('canvas');
      c.width = 640; c.height = 340;
      const g = c.getContext('2d');
      let r = seed * 9301 + 49297;
      const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
      for (let i = 0; i < 16; i++) {
        const x = 120 + rnd() * 400, y = 190 + (rnd() - .5) * 70 - Math.sin((x - 120) / 400 * Math.PI) * 40;
        const rad = 50 + rnd() * 60;
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, 'rgba(255,255,255,.55)');
        grd.addColorStop(.6, 'rgba(255,255,255,.28)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      }
      return (sprites[seed] = c);
    }

    function build() {
      const s = scene, R = Math.random;
      const area = (W * H) / (390 * 844);
      clouds = Array.from({ length: s.clouds }, (_, i) => ({
        sp: cloudSprite((i % 6) + 1),
        x: R() * (W + 400) - 300,
        y: -40 + R() * H * (s.rain || s.snow || s.lightning ? 0.35 : 0.45),
        sc: 0.6 + R() * 0.9,
        v: (6 + R() * 10) * (s.wind ? 3.5 : 1),
        a: 0.55 + R() * 0.45,
      }));
      drops = Array.from({ length: Math.round(220 * s.rain * area) }, () => newDrop(true));
      flakes = Array.from({ length: Math.round(150 * s.snow * area) }, () => newFlake(true));
      stars = s.stars ? Array.from({ length: Math.round(140 * area) }, () => ({ x: R() * W, y: R() * H * 0.7, r: R() * 1.3 + 0.3, p: R() * 6.28, sp: 0.5 + R() * 2 })) : [];
      streaks = s.wind ? Array.from({ length: 14 }, () => newStreak(true)) : [];
      leaves = s.wind && !s.night && !s.rain && !s.snow ? Array.from({ length: 9 }, () => newLeaf(true)) : [];
      fogs = s.fog ? Array.from({ length: 7 }, (_, i) => ({ y: H * (0.25 + i * 0.11), x: R() * W, v: 8 + R() * 12, h: 90 + R() * 80, a: 0.18 + R() * 0.16 })) : [];
      splashes = [];
    }
    const slant = () => (scene.wind ? 0.45 : 0.12);
    function newDrop(init) {
      const R = Math.random, z = 0.4 + R() * 0.6;
      return { x: R() * (W + 200) - 100, y: init ? R() * H : -20 - R() * 100, z, l: 12 + z * 16, v: 650 + z * 550 };
    }
    function newFlake(init) {
      const R = Math.random, z = 0.3 + R() * 0.7;
      return { x: R() * W, y: init ? R() * H : -10, z, r: 1 + z * 2.6, v: 30 + z * 60, p: R() * 6.28 };
    }
    function newStreak(init) {
      const R = Math.random;
      return { x: init ? R() * W : -300 - R() * 400, y: R() * H * 0.85, len: 120 + R() * 220, v: 500 + R() * 500, a: 0.12 + R() * 0.2, amp: 6 + R() * 14, ph: R() * 6.28 };
    }
    function newLeaf(init) {
      const R = Math.random;
      return { x: init ? R() * W : -30, y: R() * H * 0.9, v: 220 + R() * 260, rot: R() * 6.28, vr: (R() - .5) * 8, s: 6 + R() * 6, ph: R() * 6.28, hue: [32, 45, 18, 90][Math.floor(R() * 4)] };
    }

    function drawSun(t) {
      const x = W * 0.78, y = H * 0.12;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * 0.7);
      glow.addColorStop(0, 'rgba(255,250,220,.75)');
      glow.addColorStop(0.08, 'rgba(255,240,190,.45)');
      glow.addColorStop(0.3, 'rgba(255,220,150,.12)');
      glow.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.03);
      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6);
        const g = ctx.createLinearGradient(0, 0, 0, H * 0.75);
        g.addColorStop(0, 'rgba(255,255,230,.16)'); g.addColorStop(1, 'rgba(255,255,230,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(60 + (i % 3) * 20, H * 0.75); ctx.lineTo(-60 - (i % 2) * 20, H * 0.75); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(255,253,240,.95)';
      ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.fill();
      // lens flare
      const fx = W * 0.5 - (x - W * 0.5), fy = H * 0.5 - (y - H * 0.5);
      [[0.35, 26, .08], [0.6, 12, .1], [0.85, 40, .05]].forEach(([k, r, a]) => {
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath(); ctx.arc(x + (fx - x) * k, y + (fy - y) * k, r, 0, Math.PI * 2); ctx.fill();
      });
    }

    function drawMoon() {
      const x = W * 0.78, y = H * 0.12;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 180);
      glow.addColorStop(0, 'rgba(230,235,255,.35)'); glow.addColorStop(1, 'rgba(230,235,255,0)');
      ctx.fillStyle = glow; ctx.fillRect(x - 180, y - 180, 360, 360);
      ctx.fillStyle = '#f2f0dc'; ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.08)';
      [[-6, -4, 5], [6, 5, 4], [2, -9, 3]].forEach(([a, b, r]) => { ctx.beginPath(); ctx.arc(x + a, y + b, r, 0, Math.PI * 2); ctx.fill(); });
    }

    function frame(now) {
      requestAnimationFrame(frame);
      if (!scene || document.hidden) { last = now; return; }
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      const s = scene, R = Math.random;

      if (s.stars) {
        for (const st of stars) {
          ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t * st.sp + st.p));
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (!shooting && R() < dt * 0.12) shooting = { x: R() * W * 0.6, y: R() * H * 0.3, life: 0 };
        if (shooting) {
          shooting.life += dt;
          const p = shooting.life / 0.9, x = shooting.x + p * 260, y = shooting.y + p * 120;
          const g = ctx.createLinearGradient(x - 90, y - 42, x, y);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,255,255,${0.9 * (1 - p)})`);
          ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 90, y - 42); ctx.lineTo(x, y); ctx.stroke();
          if (p >= 1) shooting = null;
        }
        if (s.clouds < 6) drawMoon();
      }
      if (s.sun) drawSun(t);

      // clouds
      for (const c of clouds) {
        c.x += c.v * dt;
        const w = c.sp.width * c.sc, h = c.sp.height * c.sc;
        if (c.x > W + 50) { c.x = -w - R() * 200; c.y = -40 + R() * H * 0.4; }
        ctx.globalAlpha = c.a;
        ctx.drawImage(c.sp, c.x, c.y, w, h);
      }
      ctx.globalAlpha = 1;
      if (s.cloudShade < 1 && clouds.length) {
        const g = ctx.createLinearGradient(0, 0, 0, H * 0.6);
        g.addColorStop(0, `rgba(10,15,25,${(1 - s.cloudShade) * 0.3})`);
        g.addColorStop(1, 'rgba(10,15,25,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H * 0.6);
      }

      // fog
      for (const f of fogs) {
        f.x += f.v * dt; if (f.x > W) f.x -= W;
        const g = ctx.createLinearGradient(0, f.y - f.h / 2, 0, f.y + f.h / 2);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, `rgba(255,255,255,${f.a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.ellipse(f.x + k * W, f.y, W * 0.6, f.h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // rain
      if (drops.length) {
        const sl = slant();
        ctx.lineCap = 'round';
        for (const d of drops) {
          d.y += d.v * dt; d.x += d.v * sl * dt;
          if (d.y > H) {
            if (R() < 0.3) splashes.push({ x: d.x, y: H - 2 - R() * 40, life: 0 });
            Object.assign(d, newDrop(false));
          }
          ctx.strokeStyle = `rgba(210,225,255,${0.25 + d.z * 0.4})`;
          ctx.lineWidth = 0.6 + d.z;
          ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * sl, d.y - d.l); ctx.stroke();
        }
        for (let i = splashes.length - 1; i >= 0; i--) {
          const sp = splashes[i]; sp.life += dt;
          const p = sp.life / 0.3;
          if (p >= 1) { splashes.splice(i, 1); continue; }
          ctx.strokeStyle = `rgba(220,230,255,${0.5 * (1 - p)})`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.ellipse(sp.x, sp.y, 2 + p * 9, 1 + p * 2.5, 0, 0, Math.PI * 2); ctx.stroke();
        }
      }

      // snow
      for (const f of flakes) {
        f.y += f.v * dt; f.x += (Math.sin(t * 1.3 + f.p) * 18 + (s.wind ? 70 : 0)) * dt * f.z;
        if (f.y > H + 10 || f.x > W + 10) Object.assign(f, newFlake(false), f.x > W + 10 ? { x: -5 } : {});
        ctx.globalAlpha = 0.5 + f.z * 0.5;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // wind streaks + leaves
      for (const w of streaks) {
        w.x += w.v * dt;
        if (w.x - w.len > W) Object.assign(w, newStreak(false));
        ctx.strokeStyle = `rgba(255,255,255,${w.a})`; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let k = 0; k <= 12; k++) {
          const px = w.x - w.len + (w.len * k) / 12;
          const py = w.y + Math.sin(px / 60 + w.ph + t * 2) * w.amp;
          k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
      for (const l of leaves) {
        l.x += l.v * dt; l.y += Math.sin(t * 3 + l.ph) * 40 * dt; l.rot += l.vr * dt;
        if (l.x > W + 30) Object.assign(l, newLeaf(false));
        ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot);
        ctx.fillStyle = `hsla(${l.hue},70%,45%,.9)`;
        ctx.beginPath(); ctx.ellipse(0, 0, l.s, l.s * 0.45, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-l.s, 0); ctx.lineTo(l.s, 0); ctx.stroke();
        ctx.restore();
      }

      // lightning
      if (s.lightning) {
        if (now > nextBolt) {
          flash = 1; nextBolt = now + 3000 + R() * 6000;
          let x = W * (0.2 + R() * 0.6), y = 0; const pts = [[x, y]];
          while (y < H * 0.65) { x += (R() - 0.5) * 70; y += 25 + R() * 35; pts.push([x, y]); }
          bolt = { pts, life: 0 };
        }
        if (flash > 0) {
          ctx.fillStyle = `rgba(220,230,255,${flash * 0.35})`; ctx.fillRect(0, 0, W, H);
          flash -= dt * 2.6;
        }
        if (bolt) {
          bolt.life += dt;
          const a = Math.max(0, 1 - bolt.life / 0.35) * (bolt.life < 0.12 || bolt.life > 0.18 ? 1 : 0.2);
          ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 2.5; ctx.shadowColor = '#aac8ff'; ctx.shadowBlur = 18;
          ctx.beginPath(); bolt.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
          ctx.shadowBlur = 0;
          if (bolt.life > 0.35) bolt = null;
        }
      }
    }

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
    return {
      set(s) {
        scene = s; build(); nextBolt = performance.now() + 1200;
        document.documentElement.style.setProperty('--sky-top', s.top);
        document.documentElement.style.setProperty('--sky-bottom', s.bottom);
        const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = s.top;
      },
    };
  })();

  // ---------------------------------------------------------- locations
  const allLocs = () => [state.current || { ...DEFAULT_LOC, isCurrent: true, pending: true }, ...state.saved];
  const sameLoc = (a, b) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

  function locateMe() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 },
      );
    });
  }

  async function reverseName(lat, lon) {
    try {
      const j = await getJSON(API.reverse, { latitude: lat, longitude: lon, localityLanguage: 'en' });
      return { name: j.city || j.locality || j.principalSubdivision || 'My Location', admin: j.principalSubdivision || '', country: j.countryName || '' };
    } catch { return { name: 'My Location', admin: '', country: '' }; }
  }

  async function initCurrent() {
    const pos = await locateMe();
    if (pos) {
      const nm = await reverseName(pos.lat, pos.lon);
      state.current = { ...nm, ...pos, isCurrent: true };
      hideNotice();
    } else {
      state.current = { ...DEFAULT_LOC, isCurrent: true, fallback: true };
      showNotice('Location access unavailable — showing Cupertino. Tap ☰ to search for your city.');
    }
  }

  // ------------------------------------------------------------ fetching
  async function fetchForecast(loc) {
    return getJSON(API.forecast, {
      latitude: loc.lat, longitude: loc.lon, timezone: 'auto', forecast_days: 16,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,dew_point_2m',
      hourly: 'temperature_2m,weather_code,precipitation_probability,is_day,wind_speed_10m,wind_gusts_10m,uv_index,visibility',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max',
    });
  }

  // 30-day outlook: days 1–16 from the deterministic forecast, 17–30 from GFS ensemble (35-day range)
  async function fetchExtended(loc) {
    const models = ['gfs05', 'gfs_seamless'];
    for (const m of models) {
      try {
        const j = await getJSON(API.ensemble, {
          latitude: loc.lat, longitude: loc.lon, timezone: 'auto', forecast_days: 35, models: m,
          hourly: 'temperature_2m,precipitation,cloud_cover',
        });
        const days = aggregateEnsemble(j.hourly);
        if (days.length > 16) return days;
      } catch { /* try next */ }
    }
    return null;
  }

  function aggregateEnsemble(h) {
    const members = (prefix) => Object.keys(h).filter((k) => k === prefix || k.startsWith(prefix + '_member'));
    const tKeys = members('temperature_2m'), pKeys = members('precipitation'), cKeys = members('cloud_cover');
    const byDate = new Map();
    h.time.forEach((iso, i) => {
      const d = iso.slice(0, 10);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(i);
    });
    const out = [];
    for (const [date, idx] of byDate) {
      const maxs = [], mins = [], sums = [], clouds = [];
      tKeys.forEach((k) => {
        const v = idx.map((i) => h[k][i]).filter((x) => x != null);
        if (v.length >= 4) { maxs.push(Math.max(...v)); mins.push(Math.min(...v)); }
      });
      pKeys.forEach((k) => {
        const v = idx.map((i) => h[k][i]).filter((x) => x != null);
        if (v.length) sums.push(v.reduce((a, b) => a + b, 0));
      });
      cKeys.forEach((k) => idx.forEach((i) => { if (h[k][i] != null) clouds.push(h[k][i]); }));
      if (!maxs.length) continue;
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const tmax = mean(maxs), tmin = mean(mins);
      const precip = sums.length ? mean(sums) : 0;
      const pop = sums.length ? Math.round((sums.filter((s) => s >= 1).length / sums.length) * 100) : 0;
      const cc = clouds.length ? mean(clouds) : 50;
      let code;
      if (pop >= 55) code = tmax < 1 ? 73 : precip > 10 ? 65 : 63;
      else if (pop >= 35) code = tmax < 1 ? 85 : 80;
      else if (cc > 75) code = 3;
      else if (cc > 45) code = 2;
      else if (cc > 20) code = 1;
      else code = 0;
      out.push({ date, max: tmax, min: tmin, code, pop, ext: true });
    }
    return out;
  }

  // ------------------------------------------------------------ rendering
  function render() {
    const d = state.data, loc = state.loc;
    if (!d) return;
    const c = d.current;
    const nowIso = localNow(d.utc_offset_seconds);
    const today = d.daily;

    FX.set(window.__sceneOverride || sceneFor(c.weather_code, c.is_day, c.wind_speed_10m, c.wind_gusts_10m));

    $('heroLabel').textContent = loc.isCurrent ? (loc.fallback ? 'Default Location' : 'My Location') : '';
    $('heroCity').textContent = loc.name;
    $('heroTemp').textContent = T(c.temperature_2m);
    const cond = condText(c.weather_code, c.wind_speed_10m);
    $('heroCond').textContent = cond;
    $('heroHL').textContent = `H:${T(today.temperature_2m_max[0])}  L:${T(today.temperature_2m_min[0])}`;
    $('compactCity').textContent = loc.name;
    $('compactLine').textContent = `${T(c.temperature_2m)} | ${cond}`;
    $('unitBtn').textContent = '°' + state.unit;
    document.title = `${T(c.temperature_2m)} ${loc.name} — Skies Weather`;

    renderHourly(d, nowIso);
    renderDaily();
    renderTiles(d, nowIso);
    renderDots();
  }

  function renderHourly(d, nowIso) {
    const h = d.hourly;
    const cur = nowIso.slice(0, 13);
    let start = h.time.findIndex((t) => t.slice(0, 13) === cur);
    if (start < 0) start = 0;
    const end = Math.min(start + 25, h.time.length);
    const lastT = h.time[end - 1];

    // sunrise/sunset events inside the 24h window
    const events = [];
    d.daily.time.forEach((_, i) => {
      [['sunrise', d.daily.sunrise[i]], ['sunset', d.daily.sunset[i]]].forEach(([type, iso]) => {
        if (iso && iso > nowIso && iso <= lastT) events.push({ type, iso });
      });
    });

    const items = [];
    for (let i = start; i < end; i++) {
      items.push({ iso: h.time[i], html: `<div class="hour">
        <div class="h-time">${i === start ? 'Now' : fmtHour(hourOf(h.time[i]))}</div>
        <div class="h-icon">${icon(i === start ? d.current.weather_code : h.weather_code[i], i === start ? d.current.is_day : h.is_day[i], h.wind_speed_10m[i])}
        ${h.precipitation_probability[i] >= 20 ? `<span class="h-pop">${h.precipitation_probability[i]}%</span>` : ''}</div>
        <div class="h-temp">${i === start ? T(d.current.temperature_2m) : T(h.temperature_2m[i])}</div></div>` });
    }
    events.forEach((e) => items.push({ iso: e.iso, html: `<div class="hour sun">
      <div class="h-time">${fmtClock(e.iso)}</div>
      <div class="h-icon">${sunriseIcon(e.type === 'sunrise')}</div>
      <div class="h-temp">${e.type === 'sunrise' ? 'Sunrise' : 'Sunset'}</div></div>` }));
    items.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
    // keep "Now" first even if an event shares its hour
    $('hourly').innerHTML = items.map((x) => x.html).join('');
    $('hourly').scrollLeft = 0;
    $('summary').textContent = summarize(d, start, end);
  }

  function summarize(d, start, end) {
    const h = d.hourly, c = d.current;
    const k0 = kind(c.weather_code);
    let msg = '';
    const wet = (i) => ['rain', 'drizzle', 'storm', 'snow'].includes(kind(h.weather_code[i])) && h.precipitation_probability[i] >= 40;
    if (['rain', 'drizzle', 'storm', 'snow'].includes(k0)) {
      let stop = -1;
      for (let i = start + 1; i < end; i++) if (!wet(i)) { stop = i; break; }
      msg = `${WMO[c.weather_code]} right now` + (stop > 0 ? `, easing around ${fmtHour(hourOf(h.time[stop]))}.` : ', continuing through the next 24 hours.');
    } else {
      let first = -1;
      for (let i = start + 1; i < end; i++) if (wet(i)) { first = i; break; }
      if (first > 0) {
        const kk = kind(h.weather_code[first]);
        msg = `${kk === 'snow' ? 'Snow' : kk === 'storm' ? 'Thunderstorms' : 'Rain'} expected around ${fmtHour(hourOf(h.time[first]))}.`;
      } else {
        const label = { clear: 'Clear', partly: 'Partly cloudy', cloud: 'Cloudy', fog: 'Foggy' }[k0] || 'Calm';
        msg = `${label} conditions expected for the next 24 hours.`;
      }
    }
    const maxGust = Math.max(...h.wind_gusts_10m.slice(start, end).filter((x) => x != null));
    if (maxGust >= 40) msg += ` Wind gusts are up to ${windU(maxGust)}.`;
    return msg;
  }

  function tempColor(c) {
    // blue (cold) → teal → green → yellow → orange → red (hot)
    const stops = [[-10, [94, 92, 230]], [0, [64, 156, 255]], [10, [52, 199, 190]], [18, [140, 210, 80]], [25, [255, 204, 0]], [32, [255, 140, 0]], [40, [255, 59, 48]]];
    if (c <= stops[0][0]) return `rgb(${stops[0][1]})`;
    for (let i = 1; i < stops.length; i++) {
      if (c <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (c - a) / (b - a);
        return `rgb(${ca.map((v, j) => Math.round(v + (cb[j] - v) * f)).join(',')})`;
      }
    }
    return `rgb(${stops[stops.length - 1][1]})`;
  }

  function dailyRows() {
    const d = state.data.daily;
    const base = d.time.map((date, i) => ({
      date, max: d.temperature_2m_max[i], min: d.temperature_2m_min[i], code: d.weather_code[i], pop: d.precipitation_probability_max[i] || 0,
    }));
    if (state.range === 10) return base.slice(0, 10);
    const rows = base.slice(0, 30);
    if (state.ext) {
      const have = new Set(rows.map((r) => r.date));
      for (const e of state.ext) {
        if (rows.length >= 30) break;
        if (!have.has(e.date) && e.date > rows[rows.length - 1].date) rows.push(e);
      }
    }
    return rows;
  }

  function renderDaily() {
    const box = $('daily'), note = $('dailyNote');
    $('dailyTitle').textContent = state.range === 10 ? '10-Day Forecast' : '30-Day Forecast';
    document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', +b.dataset.range === state.range));
    const rows = dailyRows();
    const lo = Math.min(...rows.map((r) => r.min)), hi = Math.max(...rows.map((r) => r.max));
    const span = Math.max(hi - lo, 1);
    const cur = state.data.current.temperature_2m;
    const long = state.range === 30;
    let html = '', tagged = false;
    rows.forEach((r, i) => {
      if (r.ext && !tagged) { html += '<span class="ext-tag">Extended outlook</span>'; tagged = true; }
      const dt = ymd(r.date);
      const name = i === 0 ? 'Today' : DAYS[dt.getUTCDay()];
      const sub = long ? `<small>${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}</small>` : '';
      const left = ((r.min - lo) / span) * 100, width = ((r.max - r.min) / span) * 100;
      const grad = `linear-gradient(90deg, ${tempColor(r.min)}, ${tempColor(r.max)})`;
      const dot = i === 0 && cur != null ? `<span class="now" style="left:${Math.min(100, Math.max(0, ((cur - lo) / span) * 100))}%"></span>` : '';
      html += `<div class="row${r.ext ? ' ext' : ''}">
        <div class="d-name">${name}${sub}</div>
        <div class="d-icon">${icon(r.code, 1)}${r.pop >= 30 ? `<span class="pop">${r.pop}%</span>` : ''}</div>
        <div class="d-lo">${T(r.min)}</div>
        <div class="bar"><span class="fill" style="left:${left}%;width:${Math.max(width, 3)}%;background:${grad}"></span>${dot}</div>
        <div class="d-hi">${T(r.max)}</div></div>`;
    });
    if (long && !state.ext) html += '<div class="loading">Loading extended outlook…</div>';
    box.innerHTML = html;
    if (long) {
      note.classList.remove('hidden');
      note.textContent = state.ext === false
        ? 'Extended outlook is unavailable right now — showing the 16-day forecast.'
        : 'Days 1–16 come from the high-resolution forecast. Days 17–30 are an extended outlook averaged from 31 GFS ensemble runs, so treat them as a general trend.';
    } else note.classList.add('hidden');
  }

  function uvLabel(u) { return u < 3 ? 'Low' : u < 6 ? 'Moderate' : u < 8 ? 'High' : u < 11 ? 'Very High' : 'Extreme'; }
  const dirName = (deg) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16];

  function renderTiles(d, nowIso) {
    const c = d.current, dl = d.daily, h = d.hourly;
    const idx = Math.max(0, h.time.findIndex((t) => t.slice(0, 13) === nowIso.slice(0, 13)));
    const uv = h.uv_index[idx] ?? 0;
    const vis = c.visibility ?? h.visibility[idx];
    const visTxt = vis == null ? '--' : state.unit === 'F' ? `${(vis / 1609).toFixed(vis < 16000 ? 1 : 0)} mi` : `${(vis / 1000).toFixed(vis < 10000 ? 1 : 0)} km`;
    const feels = c.apparent_temperature, diff = feels - c.temperature_2m;
    const sunrise = dl.sunrise[0], sunset = dl.sunset[0];
    const nextIsSunset = nowIso > sunrise && nowIso < sunset;
    const precip = state.unit === 'F' ? `${(dl.precipitation_sum[0] / 25.4).toFixed(2)}″` : `${dl.precipitation_sum[0].toFixed(1)} mm`;
    const tomorrowP = dl.precipitation_sum[1];
    const pressure = state.unit === 'F' ? `${(c.pressure_msl * 0.02953).toFixed(2)} inHg` : `${Math.round(c.pressure_msl)} hPa`;

    // sun position along arc
    const toMin = (iso) => hourOf(iso) * 60 + parseInt(iso.slice(14, 16), 10);
    const sr = toMin(sunrise), ss = toMin(sunset), nm = toMin(nowIso);
    const p = Math.min(1, Math.max(0, (nm - sr) / (ss - sr)));
    const sx = 10 + p * 180, sy = 45 - Math.sin(p * Math.PI) * 35;

    const tile = (title, iconPath, body, wide = false) => `<div class="tile${wide ? ' wide' : ''}"><div class="tile-title"><svg class="ti" viewBox="0 0 24 24">${iconPath}</svg>${title}</div>${body}</div>`;
    const ST = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"';

    const arrow = c.wind_direction_10m; // direction wind comes FROM; arrow points where it blows
    const compass = `<svg class="compass" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="1"/>
      ${Array.from({ length: 36 }, (_, i) => `<line x1="60" y1="${i % 9 === 0 ? 12 : 13}" x2="60" y2="18" stroke="rgba(255,255,255,${i % 9 === 0 ? .8 : .35})" stroke-width="${i % 9 === 0 ? 2 : 1}" transform="rotate(${i * 10} 60 60)"/>`).join('')}
      <text x="60" y="30" font-size="10" fill="#fff" text-anchor="middle" font-weight="700">N</text>
      <text x="94" y="64" font-size="10" fill="rgba(255,255,255,.7)" text-anchor="middle">E</text>
      <text x="60" y="98" font-size="10" fill="rgba(255,255,255,.7)" text-anchor="middle">S</text>
      <text x="26" y="64" font-size="10" fill="rgba(255,255,255,.7)" text-anchor="middle">W</text>
      <g transform="rotate(${arrow + 180} 60 60)"><line x1="60" y1="94" x2="60" y2="28" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="M60 22l-6 10h12z" fill="#fff"/><circle cx="60" cy="94" r="3.5" fill="none" stroke="#fff" stroke-width="2"/></g>
      <circle cx="60" cy="60" r="17" fill="rgba(0,0,0,.35)"/>
      <text x="60" y="60" font-size="13" fill="#fff" text-anchor="middle" font-weight="600">${Math.round(state.unit === 'F' ? c.wind_speed_10m * 0.621371 : c.wind_speed_10m)}</text>
      <text x="60" y="71" font-size="8" fill="#fff" text-anchor="middle">${state.unit === 'F' ? 'mph' : 'km/h'}</text></svg>`;

    $('tiles').innerHTML = [
      tile('UV Index', `<circle cx="12" cy="12" r="4" ${ST}/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" ${ST}/>`,
        `<div class="big">${Math.round(uv)}</div><div class="sub">${uvLabel(uv)}</div><div class="uv-bar"><span class="now" style="left:${Math.min(100, (uv / 11) * 100)}%"></span></div><div class="foot">Max today: ${Math.round(dl.uv_index_max[0] ?? 0)} (${uvLabel(dl.uv_index_max[0] ?? 0)})</div>`),
      tile(nextIsSunset ? 'Sunset' : 'Sunrise', `<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 4v5M9 7l3-3 3 3" ${ST}/>`,
        `<div class="big">${fmtClock(nextIsSunset ? sunset : (nowIso < sunrise ? sunrise : dl.sunrise[1]))}</div>
        <svg class="sun-arc" viewBox="0 0 200 50"><path d="M10 45 Q100 -25 190 45" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/><line x1="0" y1="45" x2="200" y2="45" stroke="rgba(255,255,255,.35)"/><circle cx="${sx}" cy="${sy}" r="6" fill="#fff" ${p <= 0 || p >= 1 ? 'opacity=".4"' : ''}/></svg>
        <div class="foot">${nextIsSunset ? 'Sunrise' : 'Sunset'}: ${fmtClock(nextIsSunset ? sunrise : sunset)}</div>`),
      tile('Wind', `<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7" ${ST}/>`,
        `${compass}<div class="foot">${dirName(arrow)} · Gusts ${windU(c.wind_gusts_10m)}</div>`),
      tile('Feels Like', `<path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z" ${ST}/>`,
        `<div class="big">${T(feels)}</div><div class="foot">${Math.abs(diff) < 1.5 ? 'Similar to the actual temperature.' : diff < 0 ? (c.wind_speed_10m > 15 ? 'Wind is making it feel colder.' : 'Feels cooler than the actual temperature.') : 'Humidity is making it feel warmer.'}</div>`),
      tile('Precipitation', `<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" ${ST}/>`,
        `<div class="big">${precip}</div><div class="sub">Today</div><div class="foot">${tomorrowP > 0.2 ? `${state.unit === 'F' ? (tomorrowP / 25.4).toFixed(2) + '″' : tomorrowP.toFixed(1) + ' mm'} expected tomorrow.` : 'None expected tomorrow.'}</div>`),
      tile('Humidity', `<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" ${ST}/><path d="M9 14a3 3 0 0 0 3 3" ${ST}/>`,
        `<div class="big">${Math.round(c.relative_humidity_2m)}%</div><div class="foot">The dew point is ${T(c.dew_point_2m)} right now.</div>`),
      tile('Visibility', `<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" ${ST}/><circle cx="12" cy="12" r="3" ${ST}/>`,
        `<div class="big">${visTxt}</div><div class="foot">${vis == null ? '' : vis >= 10000 ? 'Perfectly clear view.' : vis >= 4000 ? 'Light haze is reducing visibility.' : 'Low visibility. Take care on the roads.'}</div>`),
      tile('Pressure', `<circle cx="12" cy="12" r="9" ${ST}/><path d="M12 12l4-4" ${ST}/>`,
        `<div class="big" style="font-size:26px">${pressure}</div><div class="foot">${c.pressure_msl < 1005 ? 'Low pressure — unsettled weather likely.' : c.pressure_msl > 1022 ? 'High pressure — settled weather likely.' : 'Normal pressure.'}</div>`),
    ].join('');
  }

  function renderDots() {
    const n = allLocs().length;
    $('dots').innerHTML = Array.from({ length: n }, (_, i) => i === 0
      ? `<button class="loc${state.index === 0 ? ' active' : ''}" data-i="0" aria-label="My location"><svg viewBox="0 0 24 24"><path d="M21 3L3 10.5l7.5 3 3 7.5z" fill="currentColor"/></svg></button>`
      : `<button class="${state.index === i ? 'active' : ''}" data-i="${i}" aria-label="Location ${i}"></button>`).join('');
  }

  // ------------------------------------------------------------- loading
  let loadToken = 0;
  async function load(index) {
    const locs = allLocs();
    state.index = Math.max(0, Math.min(index, locs.length - 1));
    const loc = locs[state.index];
    state.loc = loc;
    state.ext = null;
    const token = ++loadToken;
    if (!state.data) $('heroCity').textContent = loc.name;
    try {
      const data = await fetchForecast(loc);
      if (token !== loadToken) return;
      state.data = data;
      render();
      if (state.range === 30) loadExtended();
    } catch (e) {
      if (token !== loadToken) return;
      $('heroCity').textContent = loc.name;
      showNotice(`Couldn’t load weather (${e.message}). Check your connection and tap to retry.`, () => load(state.index));
    }
  }

  async function loadExtended() {
    if (state.ext !== null) return;
    const loc = state.loc, token = loadToken;
    const ext = await fetchExtended(loc);
    if (token !== loadToken) return;
    state.ext = ext || false;
    renderDaily();
  }

  function showNotice(msg, onClick) {
    const n = $('notice');
    n.textContent = msg; n.classList.remove('hidden');
    n.onclick = onClick ? () => { hideNotice(); onClick(); } : null;
    n.style.cursor = onClick ? 'pointer' : '';
  }
  function hideNotice() { $('notice').classList.add('hidden'); }

  // ------------------------------------------------------------ the sheet
  const sheet = $('sheet');
  function openSheet() {
    sheet.classList.remove('hidden');
    $('searchInput').value = '';
    $('results').classList.add('hidden');
    $('savedList').classList.remove('hidden');
    renderSaved();
  }
  function closeSheet() { sheet.classList.add('hidden'); }

  const cardCache = new Map();
  async function renderSaved() {
    const locs = allLocs();
    const ul = $('savedList');
    ul.innerHTML = locs.map((l, i) => `<li class="loc-card" data-i="${i}" id="lc${i}">
      <div><div class="lc-name">${i === 0 ? 'My Location' : esc(l.name)}</div><div class="lc-sub">${i === 0 ? esc(l.name) : esc([l.admin, l.country].filter(Boolean).join(', '))}</div></div>
      <div class="lc-temp-wrap"><div class="lc-temp">--</div></div>
      <div class="lc-cond">&nbsp;</div><div class="lc-hl"></div>
      ${i > 0 ? `<button class="lc-del" data-del="${i}" aria-label="Remove ${esc(l.name)}">✕</button>` : ''}</li>`).join('');
    locs.forEach(async (l, i) => {
      const key = `${l.lat.toFixed(2)},${l.lon.toFixed(2)}`;
      let w = cardCache.get(key);
      if (!w || Date.now() - w.at > 10 * 60 * 1000) {
        try {
          const j = await getJSON(API.forecast, { latitude: l.lat, longitude: l.lon, timezone: 'auto', forecast_days: 1,
            current: 'temperature_2m,weather_code,is_day,wind_speed_10m,wind_gusts_10m', daily: 'temperature_2m_max,temperature_2m_min' });
          w = { at: Date.now(), j }; cardCache.set(key, w);
        } catch { return; }
      }
      const el = document.getElementById('lc' + i); if (!el) return;
      const c = w.j.current, s = sceneFor(c.weather_code, c.is_day, c.wind_speed_10m, c.wind_gusts_10m);
      el.style.background = `linear-gradient(135deg, ${s.top}, ${s.bottom})`;
      el.querySelector('.lc-temp').textContent = T(c.temperature_2m);
      el.querySelector('.lc-cond').textContent = condText(c.weather_code, c.wind_speed_10m);
      el.querySelector('.lc-hl').textContent = `H:${T(w.j.daily.temperature_2m_max[0])}  L:${T(w.j.daily.temperature_2m_min[0])}`;
    });
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  let searchTimer, searchResults = [];
  $('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    const box = $('results');
    if (q.length < 2) { box.classList.add('hidden'); $('savedList').classList.remove('hidden'); return; }
    searchTimer = setTimeout(async () => {
      try {
        const j = await getJSON(API.geocode, { name: q, count: 10, language: 'en', format: 'json' });
        searchResults = j.results || [];
        box.innerHTML = searchResults.length
          ? searchResults.map((r, i) => `<li data-r="${i}">${esc(r.name)} <small>${esc([r.admin1, r.country].filter(Boolean).join(', '))}</small></li>`).join('')
          : '<li><small>No results found.</small></li>';
      } catch {
        box.innerHTML = '<li><small>Search failed. Check your connection.</small></li>';
      }
      box.classList.remove('hidden'); $('savedList').classList.add('hidden');
    }, 250);
  });
  $('results').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-r]'); if (!li) return;
    const r = searchResults[+li.dataset.r];
    const loc = { name: r.name, admin: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude };
    let i = state.saved.findIndex((s) => sameLoc(s, loc));
    if (i < 0) { state.saved.push(loc); store.set('wx.saved', state.saved); i = state.saved.length - 1; }
    closeSheet();
    load(i + 1);
  });
  $('savedList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const i = +del.dataset.del;
      state.saved.splice(i - 1, 1); store.set('wx.saved', state.saved);
      if (state.index === i) state.index = 0; else if (state.index > i) state.index -= 1;
        renderSaved(); renderDots();
      if (state.loc && !allLocs().includes(state.loc)) load(state.index);
      return;
    }
    const card = e.target.closest('.loc-card'); if (!card) return;
    closeSheet(); load(+card.dataset.i);
  });

  // ------------------------------------------------------------- events
  $('listBtn').addEventListener('click', openSheet);
  $('sheetDone').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  $('unitBtn').addEventListener('click', () => {
    state.unit = state.unit === 'C' ? 'F' : 'C'; store.set('wx.unit', state.unit); render();
  });
  $('dots').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) load(+b.dataset.i); });
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    state.range = +b.dataset.range;
    if (!state.data) return;
    renderDaily();
    if (state.range === 30) loadExtended();
  }));

  // Collapse the big header into a compact one while scrolling (like iOS)
  const app = $('app');
  app.addEventListener('scroll', () => {
    const y = app.scrollTop;
    $('hero').style.opacity = String(Math.max(0, 1 - y / 160));
    $('compact').classList.toggle('show', y > 150);
    app.classList.toggle('scrolled', y > 150);
  }, { passive: true });

  // Swipe left/right between locations
  let sx = null, sy = null;
  app.addEventListener('touchstart', (e) => {
    if (e.target.closest('.hourly')) { sx = null; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  app.addEventListener('touchend', (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const n = allLocs().length, next = state.index + (dx < 0 ? 1 : -1);
      if (next >= 0 && next < n) load(next);
    }
    sx = null;
  }, { passive: true });

  // Refresh every 10 minutes while open
  setInterval(() => { if (!document.hidden && state.loc) load(state.index); }, 10 * 60 * 1000);

  // Backdrop preview: ?scene=rain|storm|snow|clear|partly|cloud|fog&night=1&wind=1
  const qp = new URLSearchParams(location.search);
  if (qp.get('scene')) {
    const codes = { clear: 0, partly: 2, cloud: 3, fog: 45, drizzle: 53, rain: 63, heavy: 65, snow: 73, storm: 95 };
    window.__sceneOverride = sceneFor(codes[qp.get('scene')] ?? 0, qp.get('night') ? 0 : 1, qp.get('wind') ? 45 : 5, qp.get('wind') ? 70 : 10);
    FX.set(window.__sceneOverride);
  }

  // ------------------------------------------------------------- boot
  (async () => {
    FX.set(sceneFor(0, 1, 5, 10));
    await initCurrent();   // always open on the device's current location
    load(0);
  })();
})();
