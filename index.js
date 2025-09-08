import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Constants لتقليل التكرار
const SAFE_ZONE = { left: 60, right: 60, top: 10, bottom: 10 };
const BLEED_MARGIN = 10; // لمنطقة Bleed
const DEBOUNCE_TIME = 500; // لتحديث الـ texture
const DEFAULT_CANVAS_WIDTH = 614; // المقاس الافتراضي
const DEFAULT_CANVAS_HEIGHT = 230; // المقاس الافتراضي
const ASPECT_RATIO = DEFAULT_CANVAS_WIDTH / DEFAULT_CANVAS_HEIGHT; // نسبة العرض للارتفاع

class MugDesigner {
    constructor() {
        this.meshes = {};
        this.mug = null;
        this.history = [];
        this.lastCanvasState = null;
        this.init();
        this.setupScene();
        this.setupLights();
        this.setupControls();
        this.setupFabric();
        this.setupEventListeners();
        this.loadMug();
        this.animate();
    }

    // دالة مساعدة للـ Debounce
    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    init() {
        this.container = document.getElementById('modelViewer');
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff);

        this.camera = new THREE.PerspectiveCamera(
            45,
            this.container.clientWidth / this.container.clientHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 0, 10);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);
    }

    setupScene() {
        this.scene.background = new THREE.Color(0xffffff);
    }

    setupLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);

        const mainLight = new THREE.DirectionalLight(0xffffff, 1);
        mainLight.position.set(10, 10, 10);
        this.scene.add(mainLight);

        const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
        fillLight.position.set(-10, 0, -10);
        this.scene.add(fillLight);

        const topLight = new THREE.DirectionalLight(0xffffff, 0.3);
        topLight.position.set(0, 10, 0);
        this.scene.add(topLight);

        const frontLight = new THREE.DirectionalLight(0xffffff, 0.8);
        frontLight.position.set(0, 0, 20);
        this.scene.add(frontLight);
    }

    setupControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 20;
        this.controls.maxDistance = 80;
        this.controls.target.set(0, 0, 0);
        this.controls.minPolarAngle = Math.PI / 3;
        this.controls.maxPolarAngle = Math.PI / 1.7;
        this.controls.enablePan = false;
    }

    setupFabric() {
        const mode = "Printful";
        const marginTop = 3;
        const marginBottom = 5;
        const marginLeft = 60;
        const marginRight = 60;

        let printWidth = DEFAULT_CANVAS_WIDTH;
        let printHeight = DEFAULT_CANVAS_HEIGHT;

        if (mode !== "Printful") {
            printWidth = DEFAULT_CANVAS_WIDTH + marginLeft + marginRight;
            printHeight = DEFAULT_CANVAS_HEIGHT + marginTop + marginBottom;
        }

        this.canvas = new fabric.Canvas('designCanvas', {
            backgroundColor: 'white',
            width: printWidth,
            height: printHeight,
            preserveObjectStacking: true,
        });

        if (mode === "Printful") {
            this.safeRect = new fabric.Rect({
                left: marginLeft,
                top: marginTop,
                width: printWidth - (marginLeft + marginRight),
                height: printHeight - (marginTop + marginBottom),
                fill: 'transparent',
                stroke: 'red',
                strokeWidth: 0.4,
                strokeDashArray: [15, 10],
                selectable: false,
                evented: false,
                excludeFromLayers: true,
                excludeFromExport: true,
            });
            this.canvas.add(this.safeRect);
            this.canvas.sendToBack(this.safeRect);
        }

        this.bleedRect = new fabric.Rect({
            left: -BLEED_MARGIN,
            top: -BLEED_MARGIN,
            width: printWidth + (BLEED_MARGIN * 2),
            height: printHeight + (BLEED_MARGIN * 2),
            fill: 'transparent',
            stroke: 'orange',
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false,
            excludeFromLayers: true,
            excludeFromExport: true,
        });
        this.canvas.add(this.bleedRect);
        this.canvas.sendToBack(this.bleedRect);

        this.vGuide = new fabric.Line([printWidth / 2, 0, printWidth / 2, printHeight], {
            stroke: 'rgba(0,0,255,0.5)',
            selectable: false,
            evented: false,
            visible: false,
            excludeFromLayers: true,
            excludeFromExport: true,
        });
        this.hGuide = new fabric.Line([0, printHeight / 2, printWidth, printHeight / 2], {
            stroke: 'rgba(0,0,255,0.5)',
            selectable: false,
            evented: false,
            visible: false,
            excludeFromLayers: true,
            excludeFromExport: true,
        });
        this.canvas.add(this.vGuide, this.hGuide);

        fabric.Object.prototype.transparentCorners = false;
        fabric.Object.prototype.cornerStyle = 'circle';
        fabric.Object.prototype.cornerColor = 'rgba(0,150,255,0.9)';
        fabric.Object.prototype.borderColor = 'rgba(0,150,255,0.6)';
        fabric.Object.prototype.cornerSize = 10;
        fabric.Object.prototype.padding = 5;

        fabric.Object.prototype.controls.deleteControl = new fabric.Control({
            x: 0.5,
            y: -0.5,
            offsetY: -16,
            cursorStyle: 'pointer',
            mouseUpHandler: (eventData, transform) => {
                const target = transform.target;
                target.canvas.remove(target);
                target.canvas.requestRenderAll();
                this.saveHistory();
                this.updateLayersPanel(); // نقل updateLayersPanel هنا
                this.debouncedUpdate();
                return true;
            },
            render: (ctx, left, top) => {
                const size = 16;
                const img = document.createElement('img');
                img.src = 'https://cdn-icons-png.flaticon.com/512/1214/1214428.png';
                ctx.drawImage(img, left - size / 2, top - size / 2, size, size);
            },
            cornerSize: 24,
        });

// 🔴 زر الحذف
fabric.Object.prototype.controls.deleteControl = new fabric.Control({
  x: 0.5,
  y: -0.5,
  offsetX: 16,
  offsetY: -16,
  cursorStyle: 'pointer',
  mouseUpHandler: (eventData, transform) => {
    const target = transform.target;
    const canvas = target.canvas;
    canvas.remove(target);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    return true;
  },
  render: (ctx, left, top) => {
    ctx.save();
    ctx.translate(left, top);
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2, false);
    ctx.fillStyle = 'red';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', 0, 1);
    ctx.restore();
  }
});

// 🟢 زر النسخ
fabric.Object.prototype.controls.cloneControl = new fabric.Control({
  x: -0.5,
  y: -0.5,
  offsetX: -16,
  offsetY: -16,
  cursorStyle: 'copy',
  mouseUpHandler: (eventData, transform) => {
    const target = transform.target;
    const canvas = target.canvas;
    if (target) {
      target.clone(clone => {
        clone.set({
          left: target.left + 30,
          top: target.top + 30,
          evented: true,
        });
        canvas.add(clone);
        canvas.setActiveObject(clone);
        canvas.requestRenderAll();
      });
    }
    return true;
  },
  render: (ctx, left, top) => {
    ctx.save();
    ctx.translate(left, top);
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2, false);
    ctx.fillStyle = 'green';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', 0, 1);
    ctx.restore();
  }
});


        this.updateLayersPanel();
    }

    async loadMug() {
        const loader = new GLTFLoader();
        try {
            const gltf = await new Promise((resolve, reject) => {
                loader.load('images/mug.glb', resolve, undefined, reject);
            });
            if (this.mug) this.scene.remove(this.mug);
            this.mug = gltf.scene;

            this.mug.traverse((child) => {
                if (child.isMesh) {
                    this.meshes[child.name] = child;
                    child.material = new THREE.MeshStandardMaterial({
                        metalness: 0.3,
                        roughness: 0.4,
                        color: child.material.color,
                    });
                }
            });

            const scale = 35;
            this.mug.scale.set(scale, scale, scale);

            const box = new THREE.Box3().setFromObject(this.mug);
            const center = box.getCenter(new THREE.Vector3());
            this.mug.position.sub(center);

            this.mug.rotation.y = Math.PI * 0.3;
            this.scene.add(this.mug);

            this.controls.target.set(0, 0, 0);
            this.camera.position.set(0, 0, 40);
            this.camera.lookAt(0, 0, 0);
            this.controls.minDistance = 10;
            this.controls.maxDistance = 25;
            this.controls.update();
        } catch (error) {
            console.error('Error loading mug:', error);
            alert('⚠ فشل تحميل مودل المج. حاول مرة أخرى.');
        }
    }

    updateMugTexture() {
        const outerMug = this.meshes['Object_4'];
        if (!outerMug) return;

        this.canvas.getObjects().forEach(obj => {
            if (obj.excludeFromExport) {
                obj.set({ visible: false });
            }
        });
        this.canvas.renderAll();

        const multiplier = Math.min(4, window.innerWidth / 500);
        const dataURL = this.canvas.toDataURL({
            format: 'png',
            multiplier,
            quality: 1,
        });

        this.canvas.getObjects().forEach(obj => {
            if (obj.excludeFromExport) {
                obj.set({ visible: true });
            }
        });
        this.canvas.renderAll();

        const texture = new THREE.TextureLoader().load(dataURL, (tex) => {
            tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            tex.encoding = THREE.sRGBEncoding;
            if (outerMug.material.map) outerMug.material.map.dispose();
            outerMug.material.map = tex;
            outerMug.material.needsUpdate = true;
        }, undefined, (error) => {
            console.error('Error loading texture:', error);
            alert('⚠ فشل تحميل التصميم على المج.');
        });
    }

    saveHistory() {
        this.history.push(JSON.stringify(this.canvas.toJSON()));
        if (this.history.length > 50) this.history.shift();
    }

    updateLayersPanel() {
        const layersPanel = document.getElementById('layersPanel');
        if (!layersPanel) return;

        layersPanel.innerHTML = '';
        const objects = this.canvas.getObjects();
        const designObjects = objects.filter(obj =>
            obj !== this.safeRect && obj !== this.bleedRect && obj !== this.vGuide && obj !== this.hGuide && !obj.excludeFromLayers
        );

        designObjects.forEach((obj, index) => {
            const layerDiv = document.createElement('div');
            layerDiv.className = 'layer-item';

            const label = document.createElement('span');
            label.textContent = obj.type === 'i-text' ? `Text: ${obj.text.substring(0, 20)}...` : (obj.patternImage ? 'Pattern' : `Image ${index + 1}`);
            layerDiv.appendChild(label);

            const lockBtn = document.createElement('button');
            lockBtn.textContent = obj.selectable ? '🔓' : '🔒';
            lockBtn.style.marginLeft = '10px';
            lockBtn.addEventListener('click', () => {
                obj.set({
                    selectable: !obj.selectable,
                    evented: !obj.evented,
                    hasControls: !obj.hasControls,
                });
                lockBtn.textContent = obj.selectable ? '🔓' : '🔒';
                this.canvas.renderAll();
                this.debouncedUpdate();
            });
            layerDiv.appendChild(lockBtn);

            label.addEventListener('click', () => {
                this.canvas.setActiveObject(obj);
                this.canvas.renderAll();
            });

            layersPanel.appendChild(layerDiv);
        });
    }

    updateCanvasSize(containerWidth, containerHeight) {
        let newWidth = Math.min(containerWidth, DEFAULT_CANVAS_WIDTH);
        let newHeight = newWidth / ASPECT_RATIO;

        if (newHeight > containerHeight) {
            newHeight = containerHeight;
            newWidth = newHeight * ASPECT_RATIO;
        }

        this.canvas.setDimensions({
            width: newWidth,
            height: newHeight
        });

        const marginLeft = 60;
        const marginRight = 60;
        const marginTop = 3;
        const marginBottom = 5;

        this.safeRect.set({
            left: marginLeft,
            top: marginTop,
            width: newWidth - (marginLeft + marginRight),
            height: newHeight - (marginTop + marginBottom),
        });

        this.bleedRect.set({
            left: -BLEED_MARGIN,
            top: -BLEED_MARGIN,
            width: newWidth + (BLEED_MARGIN * 2),
            height: newHeight + (BLEED_MARGIN * 2),
        });

        this.vGuide.set({
            x1: newWidth / 2,
            x2: newWidth / 2,
            y2: newHeight
        });
        this.hGuide.set({
            y1: newHeight / 2,
            y2: newHeight / 2,
            x2: newWidth
        });

        this.canvas.renderAll();
        this.debouncedUpdate();
    }

    setupEventListeners() {
        this.debouncedUpdate = this.debounce(() => this.updateMugTexture(), DEBOUNCE_TIME);

        const snapToCenter = (obj, snapPx = 10) => {
            const center = obj.getCenterPoint();
            let snapped = false;

            if (Math.abs(center.x - this.canvas.width / 2) < snapPx) {
                obj.setPositionByOrigin(new fabric.Point(this.canvas.width / 2, center.y), 'center', 'center');
                this.vGuide.set({ visible: true });
                snapped = true;
            } else {
                this.vGuide.set({ visible: false });
            }

            if (Math.abs(center.y - this.canvas.height / 2) < snapPx) {
                obj.setPositionByOrigin(new fabric.Point(center.x, this.canvas.height / 2), 'center', 'center');
                this.hGuide.set({ visible: true });
                snapped = true;
            } else {
                this.hGuide.set({ visible: false });
            }

            if (snapped) this.canvas.requestRenderAll();
        };

        const checkBounds = (obj) => {
            if (!obj) return;

            const bounds = obj.getBoundingRect(true);
            const safe = this.safeRect.getBoundingRect(true);
            const bleed = this.bleedRect.getBoundingRect(true);

            // تحذير لو خارج Bleed
            if (
                bounds.left < bleed.left ||
                bounds.left + bounds.width > bleed.left + bleed.width ||
                bounds.top < bleed.top ||
                bounds.top + bounds.height > bleed.top + bleed.height
            ) {
                this.debounce(() => {
                    console.warn('⚠ العنصر خارج منطقة الطباعة الآمنة!');
                }, 1000)();
            }

            // تقييد النصوص داخل Safe Zone
            if (obj.type === 'i-text') {
                let objWidth = obj.width * obj.scaleX;
                let objHeight = obj.height * obj.scaleY;

                // تقييد الحجم لو خارج Safe Zone
                const maxWidth = safe.width;
                const maxHeight = safe.height;

                if (objWidth > maxWidth) {
                    obj.scaleX = maxWidth / obj.width;
                    objWidth = maxWidth;
                }
                if (objHeight > maxHeight) {
                    obj.scaleY = maxHeight / obj.height;
                    objHeight = maxHeight;
                }

                // تقييد الموضع
                const objHalfW = objWidth / 2;
                const objHalfH = objHeight / 2;

                const minX = safe.left + objHalfW;
                const maxX = safe.left + safe.width - objHalfW;
                const minY = safe.top + objHalfH;
                const maxY = safe.top + safe.height - objHalfH;

                if (obj.left < minX) obj.left = minX;
                if (obj.left > maxX) obj.left = maxX;
                if (obj.top < minY) obj.top = minY;
                if (obj.top > maxY) obj.top = maxY;
            }
        };

        this.canvas.on("object:moving", ({ target }) => {
            snapToCenter(target);
            checkBounds(target); // بدون setCoords أو renderAll
        });
        this.canvas.on("object:scaling", ({ target }) => {
            checkBounds(target); // بدون setCoords أو renderAll
        });
        this.canvas.on("object:modified", ({ target }) => {
            this.vGuide.visible = false;
            this.hGuide.visible = false;
            checkBounds(target);
            target.setCoords(); // تحديث الموضع بعد التعديل
            this.canvas.renderAll();
            this.saveHistory();
            this.updateLayersPanel();
            this.debouncedUpdate();
        });
        this.canvas.on('object:added', () => {
            this.saveHistory();
            this.updateLayersPanel();
            this.debouncedUpdate();
        });
        this.canvas.on('object:removed', () => {
            this.canvas.discardActiveObject(); // إلغاء تحديد العنصر الممسوح
            this.canvas.requestRenderAll();
            this.saveHistory();
            this.updateLayersPanel();
            this.debouncedUpdate();
        });

        document.getElementById('addTextBtn').addEventListener('click', () => {
            const text = document.getElementById('textInput').value || 'Sample Text';
            const fontStyle = document.getElementById('fontStyleSelect')?.value || 'normal';
            const fabricText = new fabric.IText(text, {
                left: this.canvas.width / 2,
                top: this.canvas.height / 2,
                fontSize: 40,
                fill: document.getElementById('colorPicker')?.value || '#000000',
                fontFamily: document.getElementById('fontSelect').value,
                originX: 'center',
                originY: 'center',
                fontWeight: fontStyle.includes('bold') ? 'bold' : 'normal',
                fontStyle: fontStyle.includes('italic') ? 'italic' : 'normal',
                stroke: '#000000',
                strokeWidth: fontStyle.includes('outline') ? 1 : 0,
            });
            this.canvas.add(fabricText);
            this.canvas.setActiveObject(fabricText);
            checkBounds(fabricText);
            fabricText.setCoords();
            this.canvas.renderAll();
            this.saveHistory();
            this.updateLayersPanel();
            this.debouncedUpdate();
        });

        const imageInput = document.getElementById('imageInput');
        document.getElementById('addImageBtn').addEventListener('click', () => {
            imageInput.click();
        });

        imageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const imgURL = URL.createObjectURL(file);
                fabric.Image.fromURL(imgURL, (img) => {
                    const scale = Math.min(0.3, (this.canvas.width - 40) / img.width, (this.canvas.height - 40) / img.height);
                    const marginLeft = 60;
                    const marginRight = 60;
                    const marginTop = 10;
                    const marginBottom = 10;
                    const safeW = this.canvas.width - (marginLeft + marginRight);
                    const safeH = this.canvas.height - (marginTop + marginBottom);

                    img.set({
                        left: this.canvas.width / 2,
                        top: this.canvas.height / 2,
                        originX: 'center',
                        originY: 'center',
                        scaleX: scale,
                        scaleY: scale,
                    });

                    const clipRect = new fabric.Rect({
                        left: marginLeft,
                        top: marginTop,
                        width: safeW,
                        height: safeH,
                        absolutePositioned: true
                    });
                    img.clipPath = clipRect;

                    if (document.getElementById('grayscaleFilter')?.checked) {
                        img.filters.push(new fabric.Image.filters.Grayscale());
                        img.applyFilters();
                    }
                    this.canvas.add(img);
                    this.canvas.setActiveObject(img);
                    checkBounds(img);
                    img.setCoords();
                    this.canvas.renderAll();
                    this.saveHistory();
                    this.updateLayersPanel();
                    this.debouncedUpdate();
                }, { crossOrigin: 'Anonymous' }, (error) => {
                    console.error('Error loading image:', error);
                    alert('⚠ فشل تحميل الصورة.');
                });
            } else {
                alert('⚠ من فضلك اختر صورة أولاً');
            }
        });

        document.querySelectorAll('.color-swatch').forEach((swatch) => {
            swatch.addEventListener('click', (e) => {
                const color = e.target.dataset.color;
                const innerMug = this.meshes['Object_5'];
                if (innerMug) {
                    innerMug.material.color.setStyle(color);
                    innerMug.material.needsUpdate = true;
                }
                document.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('active'));
                e.target.classList.add('active');
            });
        });

        document.getElementById('exportBtn').addEventListener('click', () => {
            this.canvas.getObjects().forEach(obj => {
                if (obj.excludeFromExport) {
                    obj.set({ visible: false });
                }
            });
            this.canvas.renderAll();

            const exportURL = this.canvas.toDataURL({
                format: 'png',
                multiplier: 8,
                quality: 1,
            });

            this.canvas.getObjects().forEach(obj => {
                if (obj.excludeFromExport) {
                    obj.set({ visible: true });
                }
            });
            this.canvas.renderAll();

            const link = document.createElement('a');
            link.href = exportURL;
            link.download = 'mug_design.png';
            link.click();
        });

        document.getElementById('resetBtn').addEventListener('click', () => {
            this.canvas.clear();
            this.canvas.backgroundColor = 'white';

            this.safeRect = new fabric.Rect({
                left: SAFE_ZONE.left,
                top: SAFE_ZONE.top,
                width: this.canvas.width - SAFE_ZONE.left - SAFE_ZONE.right,
                height: this.canvas.height - SAFE_ZONE.top - SAFE_ZONE.bottom,
                fill: 'transparent',
                stroke: 'red',
                strokeWidth: 0.4,
                strokeDashArray: [15, 10],
                selectable: false,
                evented: false,
                excludeFromLayers: true,
                excludeFromExport: true,
            });
            this.bleedRect = new fabric.Rect({
                left: -BLEED_MARGIN,
                top: -BLEED_MARGIN,
                width: this.canvas.width - (BLEED_MARGIN * 2),
                height: this.canvas.height - (BLEED_MARGIN * 2),
                fill: 'transparent',
                stroke: 'orange',
                strokeDashArray: [5, 5],
                selectable: false,
                evented: false,
                excludeFromLayers: true,
                excludeFromExport: true,
            });
            this.canvas.add(this.bleedRect, this.safeRect, this.vGuide, this.hGuide);
            this.canvas.sendToBack(this.bleedRect);
            this.canvas.sendToBack(this.safeRect);

            const outerMug = this.meshes['Object_4'];
            if (outerMug) {
                if (outerMug.material.map) outerMug.material.map.dispose();
                outerMug.material.map = null;
                outerMug.material.needsUpdate = true;
            }

            this.history = [];
            this.updateLayersPanel();
            this.canvas.renderAll();
            this.debouncedUpdate();
        });

        document.getElementById('undoBtn').addEventListener('click', () => {
            if (this.history.length > 0) {
                this.history.pop();
                const lastState = this.history[this.history.length - 1];
                if (lastState) {
                    this.canvas.loadFromJSON(lastState, () => {
                        this.canvas.renderAll();
                        this.updateLayersPanel();
                        this.debouncedUpdate();
                    });
                } else {
                    this.canvas.clear();
                    this.canvas.backgroundColor = 'white';
                    this.canvas.add(this.bleedRect, this.safeRect, this.vGuide, this.hGuide);
                    this.canvas.renderAll();
                    this.updateLayersPanel();
                    this.debouncedUpdate();
                }
            }
        });

        document.querySelectorAll('.pattern-thumb').forEach((imgEl) => {
            imgEl.addEventListener('click', () => {
                const url = imgEl.getAttribute('src');
                this.addPatternImage(url);
            });
        });

        this.patternMovable = false;
        document.getElementById('togglePatternBtn').addEventListener('click', () => {
            this.patternMovable = !this.patternMovable;
            const button = document.getElementById('togglePatternBtn');
            button.textContent = this.patternMovable ? 'إيقاف حركة الباترن' : 'تفعيل حركة الباترن';

            this.canvas.getObjects().forEach(obj => {
                if (obj.patternImage) {
                    obj.set({
                        selectable: this.patternMovable,
                        evented: this.patternMovable,
                        hasControls: this.patternMovable,
                        lockScalingX: !this.patternMovable,
                        lockScalingY: !this.patternMovable,
                        lockRotation: !this.patternMovable,
                    });
                    obj.setCoords();
                }
            });
            this.canvas.renderAll();
            this.debouncedUpdate();
        });

        const splitter = document.querySelector('.splitter');
        const handle = document.querySelector('.splitter-handle');
        const modelContainer = document.querySelector('.model-container');
        const canvasContainer = document.querySelector('.canvas-container');

        let isDragging = false;

        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const containerRect = document.querySelector('.split-container').getBoundingClientRect();
            const x = e.clientX - containerRect.left;
            const minWidth = 300;
            const maxWidth = containerRect.width - minWidth - splitter.offsetWidth;

            let modelWidth = Math.max(minWidth, Math.min(x, maxWidth));
            modelContainer.style.maxWidth = `${modelWidth}px`;
            canvasContainer.style.maxWidth = `${containerRect.width - modelWidth - splitter.offsetWidth}px`;

            this.renderer.setSize(modelContainer.clientWidth, modelContainer.clientHeight);
            this.camera.aspect = modelContainer.clientWidth / modelContainer.clientHeight;
            this.camera.updateProjectionMatrix();

            this.updateCanvasSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        window.addEventListener('resize', () => {
            const width = modelContainer.clientWidth;
            const height = modelContainer.clientHeight;
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);

            this.updateCanvasSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
        });
    }

    addPatternImage(url) {
        fabric.Image.fromURL(
            url,
            (fImg) => {
                const dpi = 96;
                const marginTop = 3;
                const marginBottom = 5;
                const marginLeft = 60;
                const marginRight = 60;

                const safeW = this.canvas.width - (marginLeft + marginRight);
                const safeH = this.canvas.height - (marginTop + marginBottom);

                const scale = Math.max(safeW / fImg.width, safeH / fImg.height);

                fImg.set({
                    scaleX: scale,
                    scaleY: scale,
                    left: this.canvas.width / 2,
                    top: this.canvas.height / 2,
                    originX: 'center',
                    originY: 'center',
                    selectable: false,
                    evented: false,
                    hasControls: false,
                    lockScalingX: true,
                    lockScalingY: true,
                    lockRotation: true,
                    crossOrigin: 'Anonymous',
                });

                this.canvas.getObjects().forEach(obj => {
                    if (obj.patternImage) this.canvas.remove(obj);
                });

                fImg.patternImage = true;

                const clipRect = new fabric.Rect({
                    left: marginLeft,
                    top: marginTop,
                    width: safeW,
                    height: safeH,
                    absolutePositioned: true
                });

                fImg.clipPath = clipRect;

                this.canvas.add(fImg);
                this.canvas.sendToBack(fImg);
                this.canvas.renderAll();

                const border = new fabric.Rect({
                    left: marginLeft,
                    top: marginTop,
                    width: safeW,
                    height: safeH,
                    stroke: "red",
                    strokeDashArray: [5, 5],
                    fill: "transparent",
                    selectable: false,
                    evented: false,
                    excludeFromLayers: true,
                    excludeFromExport: true,
                });
                this.canvas.add(border);
                this.canvas.bringToFront(border);

                this.debouncedUpdate();
            },
            { crossOrigin: 'Anonymous' }
        );
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.controls) this.controls.update();
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
}


new MugDesigner();


