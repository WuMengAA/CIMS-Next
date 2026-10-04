<script lang="ts">
  import { page } from "$app/state";
  import { onMount, onDestroy } from "svelte";
  import { reveal } from "$lib/actions/reveal.js";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

  type Spot = { id: number; key: string; title: string; slogan: string; body: string };
  type D = { spots: Spot[] };
  const d = $derived(page.data as D);

  let mountEl: HTMLDivElement;
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let controls: OrbitControls | null = null;
  let rafId = 0;
  let activeSpot = $state<Spot | null>(null);

  // ── 自动运镜讲解 ──
  let tourActive = $state(false);
  let tourIndex = $state(0);
  let tourSpots = $state<Spot[]>([]);
  let paused = $state(false);
  const routeKeys = ["entry", "water", "south_wall", "ac", "back_wall", "hygiene"];
  const spotAngles: Record<string, [number, number]> = {
    entry: [0.2, 0.1], water: [1.1, 0.15], south_wall: [2.0, 0.05],
    ac: [2.9, 0.12], back_wall: [3.9, -0.05], hygiene: [4.8, 0.1]
  };
  function spotPos(key: string): THREE.Vector3 {
    const [a, b] = spotAngles[key] || [0, 0];
    return new THREE.Vector3(Math.cos(b) * Math.cos(a) * 49, Math.sin(b) * 49, Math.sin(a) * Math.cos(b) * 49);
  }
  function getScript(s: Spot): string {
    return "这里是" + s.title + "，我们班的理念是「" + s.slogan + "」。" + s.body + "这一设计希望让每位同学在细节中养成好习惯。";
  }
  function speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN"; u.rate = 0.9;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      const timer = setTimeout(() => resolve(), 12000);
      window.speechSynthesis.speak(u);
    });
  }
  function wait(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  async function rotateToSpot(targetPos: THREE.Vector3): Promise<void> {
    if (!camera) return;
    return new Promise((resolve) => {
      const startQuat = camera!.quaternion.clone();
      const endDir = targetPos.clone().normalize();
      const endQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), endDir);
      const start = Date.now(); const dur = 1800;
      function step() {
        if (!camera) return resolve();
        const t = Math.min(1, (Date.now() - start) / dur);
        const e = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
        camera!.quaternion.slerpQuaternions(startQuat, endQuat, e);
        if (t < 1) rafId = requestAnimationFrame(step); else resolve();
      }
      rafId = requestAnimationFrame(step);
    });
  }

  let tourRunId = 0;
  async function startTour() {
    const myRun = ++tourRunId;
    tourActive = true; tourIndex = 0; paused = false;
    tourSpots = routeKeys.map((k) => (d?.spots ?? []).find((s) => s.key === k)).filter(Boolean) as Spot[];
    for (let i = 0; i < tourSpots.length; i++) {
      if (myRun !== tourRunId) return;
      tourIndex = i;
      const s = tourSpots[i];
      while (paused && myRun === tourRunId) await wait(200);
      if (myRun !== tourRunId) return;
      activeSpot = s;
      await rotateToSpot(spotPos(s.key));
      if (myRun !== tourRunId) return;
      await speak(getScript(s));
      if (myRun !== tourRunId) return;
      await wait(800);
    }
    if (myRun === tourRunId) { tourActive = false; activeSpot = null; }
  }
  function pauseTour() { paused = !paused; }
  function skipSpot() {
    tourRunId++; tourActive = false; paused = false; activeSpot = null;
    if (tourIndex < tourSpots.length - 1) { tourIndex++; startTour(); }
  }
  function stopTour() { tourRunId++; tourActive = false; paused = false; activeSpot = null; }

  function buildPanorama(): THREE.Texture {
    const cv = document.createElement("canvas");
    cv.width = 2048; cv.height = 1024;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 1024);
    g.addColorStop(0, "#dfe7f5"); g.addColorStop(0.5, "#eef2f8"); g.addColorStop(1, "#c9d4e6");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 2048, 1024);
    ctx.strokeStyle = "rgba(120,140,180,.35)"; ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.moveTo(i * 180, 0); ctx.lineTo(i * 180, 1024); ctx.stroke(); }
    for (let j = 0; j < 6; j++) { ctx.beginPath(); ctx.moveTo(0, j * 190); ctx.lineTo(2048, j * 190); ctx.stroke(); }
    ctx.fillStyle = "#2f3b52"; ctx.fillRect(1500, 240, 480, 260);
    ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = "30px sans-serif"; ctx.fillText("2028届8班", 1580, 380);
    ctx.fillStyle = "#8b6f47"; ctx.fillRect(700, 860, 600, 160);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }

  function init() {
    if (!mountEl) return;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mountEl.clientWidth, mountEl.clientHeight);
    mountEl.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, mountEl.clientWidth / mountEl.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 0.01);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = true; controls.zoomSpeed = 0.6; controls.enablePan = false; controls.rotateSpeed = -0.6;
    const tex = buildPanorama();
    const geo = new THREE.SphereGeometry(50, 64, 40);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide });
    const sphere = new THREE.Mesh(geo, mat); sphere.scale.set(-1, 1, 1); scene.add(sphere);
    const spotsData = d?.spots ?? [];
    const angles = [[0.2, 0.1], [1.1, 0.15], [2.0, 0.05], [2.9, 0.12], [3.9, -0.05], [4.8, 0.1]];
    const geoDot = new THREE.SphereGeometry(0.6, 12, 12);
    spotsData.forEach((s, i) => {
      const [a, b] = angles[i % angles.length];
      const matDot = new THREE.MeshBasicMaterial({ color: i === 0 ? 0xf7b32b : 0x3b6cf6 });
      const dot = new THREE.Mesh(geoDot, matDot);
      dot.position.set(Math.cos(b) * Math.cos(a) * 49, Math.sin(b) * 49, Math.sin(a) * Math.cos(b) * 49);
      dot.userData.spot = s; scene!.add(dot);
    });
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    renderer.domElement.addEventListener("pointerdown", (e) => {
      if (!mountEl || !renderer || !camera || !scene) return;
      if (tourActive) return;
      const rect = mountEl.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const dots: THREE.Object3D[] = []; scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.spot) dots.push(o); });
      const hit = raycaster.intersectObjects(dots, false);
      if (hit.length && hit[0].object.userData.spot) { activeSpot = hit[0].object.userData.spot as Spot; }
    });
    function loop() {
      rafId = requestAnimationFrame(loop); controls?.update(); renderer?.render(scene!, camera!);
    }
    loop();
    onDestroy(() => { cancelAnimationFrame(rafId); renderer?.dispose(); if (renderer?.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); });
  }
  onMount(() => { setTimeout(init, 60); });
</script>
  <div class="pg-head">
    <span class="eyebrow">2028届8班 · 教室漫游</span>
    <h2 use:reveal class="reveal reveal-mask pg-title">3D 教室</h2>
    <p class="pg-sub">拖拽旋转 · 点击热点查看点位讲解 · 自动运镜讲解模式</p>
    <span use:reveal class="reveal ef-draw"></span>
  </div>
  <div use:reveal class="reveal-rise vr-wrap">
  <div class="vr-canvas" bind:this={mountEl}></div>
  {#if activeSpot}
    <div class="vr-pop">
      {#if tourActive}<span class="tour-badge">🔊 讲解中 {tourIndex + 1}/{tourSpots.length}</span>{/if}
      <button class="vr-close" onclick={() => (activeSpot = null)}>×</button>
      <h3>{activeSpot.title}</h3>
      <b>「{activeSpot.slogan}」</b>
      <p>{activeSpot.body}</p>
    </div>
  {/if}
  <div class="vr-toolbar">
    {#if !tourActive}
      <button class="tour-start" onclick={startTour}>▶ 开始讲解</button>
    {:else}
      <span class="tour-progress">第 {tourIndex + 1}/{tourSpots.length} 站</span>
      <button class="tour-btn" onclick={pauseTour}>{paused ? "▶ 继续" : "⏸ 暂停"}</button>
      <button class="tour-btn" onclick={skipSpot}>⏭ 跳过</button>
      <button class="tour-stop" onclick={stopTour}>⏹ 停止</button>
    {/if}
  </div>
</div>
<p class="hint">💡 高斯泼溅（可互动 3D 场景）已列入计划，待条件成熟接入 —— 成本高、性能消耗大。</p>
  <style>
    .pg-head { display: flex; flex-direction: column; gap: .7rem; margin-bottom: 1.8rem; max-width: 52ch; }
    .eyebrow { display: inline-flex; align-items: center; gap: .6rem; font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; color: #8a8178; font-weight: 500; }
    .eyebrow::before { content: ""; width: 1.6rem; height: 1px; background: #c8542e; }
    .pg-title { font-family: var(--font-heading); font-weight: 700; font-size: clamp(1.9rem, 4vw, 2.5rem); letter-spacing: -.02em; line-height: 1.1; margin: 0; }
    .pg-sub { color: #8a8178; font-size: .95rem; margin: 0; }
    .vr-wrap { position: relative; border-radius: 1.1rem; overflow: hidden; border: 1px solid rgba(42,38,32,.12); box-shadow: 0 18px 44px -22px rgba(42,38,32,.3); }
    .vr-canvas { width: 100%; height: 540px; background: #101018; }
    .vr-pop { position: absolute; right: 18px; top: 18px; width: 280px; background: #fffdf7; border: 1px solid rgba(42,38,32,.12); border-radius: 12px; box-shadow: 0 8px 30px rgba(42,38,32,.18); padding: 16px; }
    .vr-pop h3 { margin: 0 0 6px; font-family: var(--font-heading); font-size: 17px; }
    .vr-pop b { color: #c8542e; font-size: 14px; }
    .vr-pop p { margin: 8px 0 0; font-size: 13px; color: #4a443c; line-height: 1.7; }
    .vr-close { position: absolute; right: 10px; top: 8px; border: none; background: none; font-size: 22px; cursor: pointer; color: #8a8178; }
    .tour-badge { display: inline-block; background: #b8891a; color: #fff; font-size: 11px; padding: 3px 10px; border-radius: 999px; margin-bottom: 8px; }
    .vr-toolbar { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; align-items: center; }
    .tour-start { padding: 10px 24px; border-radius: 999px; border: none; background: #c8542e; color: #fff; font-size: 14px; cursor: pointer; font-weight: 700; transition: background .4s; }
    .tour-start:hover { background: #a8482b; }
    .tour-btn { padding: 8px 16px; border-radius: 999px; border: 1px solid rgba(42,38,32,.14); background: #fffdf7; cursor: pointer; font-size: 13px; }
    .tour-stop { padding: 8px 16px; border-radius: 999px; border: none; background: #d44b3e; color: #fff; cursor: pointer; font-size: 13px; }
    .tour-progress { font-size: 13px; font-weight: 700; color: #c8542e; }
    .hint { margin-top: 14px; font-size: 12px; color: #8a8178; }
  </style>
