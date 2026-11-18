// Deferred head scripts (Vue, Element, i18n, ...) finish before
// DOMContentLoaded fires, so everything they define is available here.
window.addEventListener('DOMContentLoaded', function () {
    const APP_VERSION = '2026.11.18-ui.5';
    const Logger = window.RealCuganLogger || {
        debug() {},
        info() {},
        warn() {
            if (window.console && window.console.warn) {
                window.console.warn.apply(window.console, arguments);
            }
        },
        error() {
            if (window.console && window.console.error) {
                window.console.error.apply(window.console, arguments);
            }
        },
    };
    const ADAPTIVE_LAYOUT = {
        controlPanelWidth: 340,
        panelGap: 15,
        stagePadding: 24,
        maxWorkspaceWidth: 1680,
        // Reserve room for the shared ready controls, not a minimum image size.
        minPreviewWidth: 620,
        minPreviewHeight: 360,
        emptyUploadWidth: 620,
        emptyUploadHeight: 360,
        stagePanelChromeHeight: 93,
        minStageWidth: 320,
    };
    const MODEL_FILES = window.MODEL_FILES;
    const IS_GPT = /\/gpt-denoise\.html$/.test(location.pathname);
    const gpt = window.GPTDenoise;

    const I18N = window.I18N;
    let srcInteractedData = null;
    let dstInteractedData = null;
    // Must stay a real global: the dynamically injected emscripten backend
    // script reads its config from window.Module. Bare `Module = ...`
    // assignments below keep writing this window property.
    window.Module = null;

    let app = new Vue({
        el: '#app',
        template: window.APP_TEMPLATE,
        data: function () {
            return {
                language: 'zh',
                isGpt: IS_GPT,
                gptMethod: 'esrgan',
                gptDown: 60,
                gptLambda: 0.001,
                themeMode: 'auto',
                systemPrefersDark: false,
                projectInfoVisible: false,
                projectInfoPinned: false,
                modelTypeRadio: 'se',
                scaleRadio: 2,
                denoiseRadio: 3,
                designDenoiseScrubbing: false,
                backendMode: 'auto',
                previewOverlapRate: 50,
                previewZoom: 100,
                previewZoomMin: 100,
                previewZoomMax: 300,
                previewZoomStep: 25,
                previewViewportWidth: 0,
                previewViewportHeight: 0,
                previewPanX: 0,
                previewPanY: 0,
                previewDragging: false,
                splitDragging: false,
                previewDragStartX: 0,
                previewDragStartY: 0,
                previewDragOriginX: 0,
                previewDragOriginY: 0,
                previewPinchStartDistance: 0,
                previewPinchStartZoom: 100,
                uploadImgSrc: '',
                uploadObjectUrl: '',
                uploadPreviewWidth: 0,
                uploadPreviewHeight: 0,
                uploadPreviewName: '',
                isProcessing: false,
                isCancelling: false,
                isProcessDone: false,
                isResultRevealing: false,
                mobileSettingsVisible: false,
                progressRate: 0,
                procFinalCostSeconds: null,
                progressTip: '',
                // output param
                outputPreviewWidth: 0,
                outputPreviewHeight: 0,
                outputScale: 0,
                outputDenoise: 0,
                outputModelType: 'se',
                windowWidth: 0,
                windowHeight: 0,
                stageLayoutTick: 0,
                outputImgSrc: '',
                outputObjectUrl: '',
                isBatchActive: false,
                isBatchProcessing: false,
                batchCancelRequested: false,
                pendingUploadFile: null,
                pendingUploadFileList: [],
                batchItems: [],
                activeBatchItemId: null,
                selectedBatchItemId: null,
                batchRunId: 0,
                extractedThemeColors: null,
                designDots: [],
                // emscripten
                wasmModuleLoaded: false,
                wasmLoading: false,
                wasmLoadingProgress: 0,
                wasmLoadPromise: null,
                wasmBackend: '',
                wasmWorker: null,
                wasmUsesWorker: false,
                activeImageId: 0,
                processRuntimeSettings: null,
                safeProcessingMode: false,
                loadedModelKey: '',
                loadedModelFiles: {},
                modelLoading: false,
                modelLoadingProgress: 0,
                modelLoadingName: '',
                modelLoadingFile: '',
                modelAssetCache: {},
                appVersion: APP_VERSION,
                processFailureDialogOpen: false,
            };
        },

        watch: {
            mobileSettingsVisible() { this.syncDrawerScrollLock(); },
        },

        computed: {
            batchDoneCount() {
                return this.batchItems.filter((item) => item.status === 'done').length;
            },

            batchProgressRate() {
                if (!this.batchItems.length) {
                    return 0;
                }
                return Math.round((this.batchDoneCount / this.batchItems.length) * 100);
            },

            batchDownloadCount() {
                return this.batchItems.filter((item) => !!item.objectUrl).length;
            },

            // Cached render hot path: the template references this up to ~10
            // times per render, and during pan drags the component re-renders
            // every frame. As a computed it is evaluated once per dependency
            // change (stageLayoutTick / zoom / image sizes — notably NOT
            // previewPanX), instead of walking down to getBoundingClientRect
            // on every access.
            zoomedPreviewSize() {
                return this.getZoomedPreviewSize();
            },

            infoPopoverPlacement() {
                return this.windowWidth <= 768 ? 'bottom' : 'right-start';
            },

            isMobile() {
                return this.windowWidth <= 1120;
            },

            getCurrentParamsText() {
                if (this.isGpt) return this.getGptRecipe();
                let model = this.modelTypeRadio === 'pro' ? this.t('model.pro') : this.t('model.se');
                let scale = this.scaleRadio + 'X';
                let denoiseLabel = this.getDenoiseLabel(this.denoiseRadio);
                return `${model} • ${scale} • ${denoiseLabel}`;
            },
        },

        mounted() {
            // Non-reactive scratch state (timers, rAF ids, handlers, promise
            // resolvers): plain instance properties, deliberately NOT in
            // data() — nothing renders from them, so Vue reactivity would be
            // pure overhead.
            this.panVelocitySamples = [];
            this.panGlideFrame = null;
            this.revealWipeFrame = null;
            this.resultRevealTimer = null;
            this.windowResizeHandler = null;
            this.stageLayoutFrame = null;
            this.stageLayoutObserver = null;
            this.processCompletionResolve = null;
            this.processCompletionReject = null;
            this.batchSelectionTimer = null;
            this.modelLoadingTimer = null;
            this.gptWorker = null;

            this.language = this.getInitialLanguage();
            this.applyLanguage();

            // watch viewport size
            this.windowWidth = window.innerWidth;
            this.windowHeight = window.innerHeight;
            this.windowResizeHandler = () => {
                this.windowWidth = window.innerWidth;
                this.windowHeight = window.innerHeight;
                // Leaving the mobile layout closes the drawer; otherwise the stale
                // flag would reopen it unexpectedly when shrinking back down.
                if (!this.isMobile && this.mobileSettingsVisible) {
                    this.closeMobileSettings();
                }
                this.syncDrawerScrollLock();
                this.scheduleStageLayoutSync();
                this.syncPreviewViewport();
            };
            window.addEventListener("resize", this.windowResizeHandler);
            this.handleDrawerKeydown = (event) => {
                if (event.key === 'Tab' && this.isMobile && this.mobileSettingsVisible) {
                    const panel = this.getRefElement('controlPanel');
                    const nodes = Array.from(panel.querySelectorAll('button, input, [tabindex="0"], a[href]'))
                        .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length
                            && getComputedStyle(node).visibility === 'visible' && !node.closest('[inert]'));
                    const first = nodes[0], last = nodes[nodes.length - 1];
                    if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
                        event.preventDefault(); if (last) last.focus();
                    } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
                        event.preventDefault(); if (first) first.focus();
                    }
                    return;
                }
                if (event.key !== 'Escape') {
                    return;
                }
                if (this.isMobile && this.mobileSettingsVisible) {
                    this.closeMobileSettings();
                    return;
                }
                // Viewer convention: Escape resets a zoomed result preview.
                if (this.isProcessDone && this.previewZoom > this.previewZoomMin) {
                    this.resetPreviewZoom();
                }
            };
            document.addEventListener('keydown', this.handleDrawerKeydown);
            this.scheduleStageLayoutSync();
            // Font loading, translated toolbar text and result controls also change
            // the available space without a window resize. Do not observe the stage
            // itself: its size is the output of this calculation.
            this.$nextTick(() => {
                this.stageLayoutObserver = new ResizeObserver(() => this.scheduleStageLayoutSync());
                for (const element of [this.getRefElement('appMain'),
                    this.$el.querySelector('.shell-head'), this.getRefElement('stageToolbar'),
                    this.$el.querySelector('.app-footer')]) {
                    if (element) this.stageLayoutObserver.observe(element);
                }
            });

            // load preferences
            let scale = this.getPreference('scale');
            let denoise = this.getPreference('denoise');
            let modelType = this.getPreference('modelType');
            let backendMode = this.getPreference('backendMode');
            let themeMode = this.getPreference('themeMode');
            // Whitelist every persisted value: stale/hand-edited storage entries
            // (e.g. scale "5", backendMode "webgpu") would otherwise break the
            // controls and 404 the model asset paths.
            if (scale && [2, 3, 4].includes(scale * 1)) {
                this.scaleRadio = scale * 1;
            }
            // Truthiness guard matters: null/'' coerce to 0, which is a valid
            // denoise level — an unset preference must not select "none".
            if (denoise && [-1, 1, 2, 3].includes(denoise * 1) || denoise === '0') {
                this.denoiseRadio = denoise * 1;
            }
            if (modelType === 'se' || modelType === 'pro') {
                this.modelTypeRadio = modelType;
            }
            this.normalizeModelOptions();
            if (['auto', 'basic', 'simd', 'simd-threads'].includes(backendMode)) {
                this.backendMode = backendMode;
            }
            if (themeMode === 'auto' || themeMode === 'light' || themeMode === 'dark') {
                this.themeMode = themeMode;
            }
            if (window.matchMedia) {
                let darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
                // Seed BEFORE the first applyThemeMode() below, or auto mode
                // starts light regardless of the OS setting.
                this.systemPrefersDark = darkQuery.matches;
                let onSystemThemeChange = () => {
                    this.systemPrefersDark = darkQuery.matches;
                    if (this.themeMode === 'auto') {
                        this.applyThemeMode();
                        if (this.extractedThemeColors) {
                            this.applyExtractedThemeColors(this.extractedThemeColors);
                        }
                    }
                };
                if (darkQuery.addEventListener) {
                    darkQuery.addEventListener('change', onSystemThemeChange);
                } else if (darkQuery.addListener) {
                    darkQuery.addListener(onSystemThemeChange);
                }
                this.removeDarkQueryListener = () => {
                    if (darkQuery.removeEventListener) {
                        darkQuery.removeEventListener('change', onSystemThemeChange);
                    } else if (darkQuery.removeListener) {
                        darkQuery.removeListener(onSystemThemeChange);
                    }
                };
            }
            this.applyThemeMode();

            // init emscripten
            Module = {
                print: (text) => {
                    if (text) {
                        Logger.debug('[emscripten]', text);
                    }
                },
                printErr: (text) => {
                    Logger.error('[emscripten]', text);
                    let lower = (text || '').toLowerCase();
                    if (this.isProcessing && (
                        lower.includes('memory access out of bounds') ||
                        lower.includes('out of memory') ||
                        lower.includes('aborted(')
                    )) {
                        this.handleProcessFailure(text);
                    }
                },
                setStatus: (text) => {
                    let match = (text || '').match(/Downloading data\.\.\. \((\d+)\/(\d+)\)/);
                    if (match && Number(match[2]) > 0) {
                        let dataProgress = Number(match[1]) / Number(match[2]);
                        this.wasmLoadingProgress = Math.min(99, Math.max(5, Math.round(5 + dataProgress * 94)));
                    }
                },
                onBackendProgress: (totalCost, tileCost, progressRate, remainingTime) => {
                    this.onProcessProgressChange(totalCost, tileCost, progressRate, remainingTime);
                },
                onBackendComplete: (imageId, cost) => {
                    this.onProcessEnd(cost);
                },
                onBackendCancelled: (imageId) => {
                    this.onProcessCancelled();
                },
                onBackendError: (imageId, code, message) => {
                    this.handleBackendProcessError({
                        image_id: imageId,
                        code: code,
                        message: message,
                    });
                },
            };
            document.addEventListener('mousedown', this.handleInfoPopoverOutside);
            document.addEventListener('touchstart', this.handleInfoPopoverOutside, {passive: true});

            this.handlePasteEvent = (event) => {
                if (this.isProcessing || this.isBatchProcessing) {
                    return;
                }
                const clipboardData = event.clipboardData || window.clipboardData;
                if (!clipboardData) {
                    return;
                }
                const items = clipboardData.items;
                let file = null;
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image/') === 0) {
                        file = items[i].getAsFile();
                        break;
                    }
                }
                if (file) {
                    let fakeFile = {
                        name: 'pasted-image-' + Date.now() + '.png',
                        raw: file
                    };
                    this.onUploadChange(fakeFile, [fakeFile]);
                }
            };
            document.addEventListener('paste', this.handlePasteEvent);
            this.initWebReMotion();
            this.handlePageHide = () => {
                if (this.isGpt) gpt.cancel(this);
            };
            window.addEventListener('pagehide', this.handlePageHide);

            // Offline support: cache-first for versioned assets, so repeat
            // visits work without a network (fits the fully-local processing).
            // The ?v= ties the SW (and its cache name) to this deploy: a new
            // version registers a byte-different SW URL, which installs fresh
            // and prunes the previous version's cache on activate.
            if ('serviceWorker' in navigator && location.protocol === 'https:') {
                navigator.serviceWorker.register(this.versionedUrl('sw.js')).catch(() => {});
            }

            // Warm the HTTP cache for the likely WASM backend and the selected
            // model during idle time, so the first upscale skips the multi-MB
            // downloads. Deliberately NOT ensureWasmLoaded(): that would flip
            // wasmLoading and disable the upload control while it runs.
            if (!(navigator.connection && navigator.connection.saveData)) {
                let warmUp = () => this.prefetchBackendAssets();
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(warmUp, {timeout: 8000});
                } else {
                    setTimeout(warmUp, 3000);
                }
            }
        },

        beforeDestroy() {
            if (this.stageLayoutObserver) this.stageLayoutObserver.disconnect();
            if (this.windowResizeHandler) {
                window.removeEventListener('resize', this.windowResizeHandler);
                this.windowResizeHandler = null;
            }
            if (this.stageLayoutFrame) {
                cancelAnimationFrame(this.stageLayoutFrame);
                this.stageLayoutFrame = null;
            }
            document.removeEventListener('mousedown', this.handleInfoPopoverOutside);
            document.removeEventListener('touchstart', this.handleInfoPopoverOutside);
            if (this.handlePasteEvent) {
                document.removeEventListener('paste', this.handlePasteEvent);
            }
            if (this.handleDrawerKeydown) {
                document.removeEventListener('keydown', this.handleDrawerKeydown);
            }
            window.removeEventListener('pagehide', this.handlePageHide);
            document.body.style.overflow = '';
            this.stopProcessWatchdog();
            this.cancelPanGlide();
            this.cancelRevealWipeSweep();
            if (this.removeDarkQueryListener) {
                this.removeDarkQueryListener();
            }
            if (this.wasmWorker) {
                this.wasmWorker.terminate();
                this.wasmWorker = null;
            }
            if (this.gptWorker) this.gptWorker.terminate();
            this.destroyWebReMotion();
        },

        methods: {
            initWebReMotion() {
                let revealNodes = this.$el.querySelectorAll('[data-reveal]');
                // Release will-change once the reveal transition completes so the
                // browser can drop the compositor layers (same visuals, less GPU memory).
                let releaseWillChange = (node) => {
                    node.addEventListener('transitionend', function handler(event) {
                        if (event.target === node && event.propertyName === 'opacity') {
                            node.style.willChange = 'auto';
                            node.removeEventListener('transitionend', handler);
                        }
                    });
                };
                // Reveal via an attribute, NOT a class: some reveal targets also
                // carry Vue :class bindings, and Vue rewrites the whole class
                // attribute on re-render — wiping an externally added class and
                // snapping the element back to opacity 0 mid-session.
                if ('IntersectionObserver' in window) {
                    this.webReRevealObserver = new IntersectionObserver((entries) => {
                        entries.forEach((entry) => {
                            if (entry.isIntersecting) {
                                releaseWillChange(entry.target);
                                entry.target.setAttribute('data-reveal-shown', '');
                                this.webReRevealObserver.unobserve(entry.target);
                            }
                        });
                    }, {threshold: 0.05});
                    revealNodes.forEach((node) => this.webReRevealObserver.observe(node));
                } else {
                    revealNodes.forEach((node) => {
                        node.setAttribute('data-reveal-shown', '');
                        node.style.willChange = 'auto';
                    });
                }

                if (
                    !window.matchMedia ||
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
                    !window.matchMedia('(min-width: 1121px) and (hover: hover) and (pointer: fine)').matches
                ) {
                    return;
                }
                this.webReParallaxNodes = Array.from(this.$el.querySelectorAll('[data-parallax]'));
                this.webReParallaxX = -100;
                this.webReParallaxY = -100;
                this.webReParallaxTargetX = -100;
                this.webReParallaxTargetY = -100;
                // Cache parallax depths once; getAttribute per pointermove is wasted work.
                let parallaxDepths = this.webReParallaxNodes.map((node) => Number(node.getAttribute('data-parallax')) || 1);
                let pointerDirty = false;
                let parallaxFrame = () => {
                    this.webReParallaxX += (this.webReParallaxTargetX - this.webReParallaxX) * 0.18;
                    this.webReParallaxY += (this.webReParallaxTargetY - this.webReParallaxY) * 0.18;
                    if (pointerDirty) {
                        pointerDirty = false;
                        let nx = this.webReParallaxTargetX / window.innerWidth - 0.5;
                        let ny = this.webReParallaxTargetY / window.innerHeight - 0.5;
                        this.webReParallaxNodes.forEach((node, i) => {
                            let depth = parallaxDepths[i];
                            node.style.transform = `translate3d(${nx * depth * 20}px, ${ny * depth * 20}px, 0)`;
                        });
                    }
                    if (
                        pointerDirty ||
                        Math.abs(this.webReParallaxTargetX - this.webReParallaxX) > 0.1 ||
                        Math.abs(this.webReParallaxTargetY - this.webReParallaxY) > 0.1
                    ) {
                        this.webReParallaxFrame = requestAnimationFrame(parallaxFrame);
                    } else {
                        this.webReParallaxFrame = null;
                    }
                };
                this.webReParallaxPointerMove = (event) => {
                    this.webReParallaxTargetX = event.clientX;
                    this.webReParallaxTargetY = event.clientY;
                    pointerDirty = true;
                    if (!this.webReParallaxFrame) {
                        this.webReParallaxFrame = requestAnimationFrame(parallaxFrame);
                    }
                };
                window.addEventListener('pointermove', this.webReParallaxPointerMove, {passive: true});
            },

            destroyWebReMotion() {
                if (this.webReRevealObserver) {
                    this.webReRevealObserver.disconnect();
                }
                if (this.webReParallaxFrame) {
                    cancelAnimationFrame(this.webReParallaxFrame);
                    this.webReParallaxFrame = null;
                }
                if (this.webReParallaxPointerMove) {
                    window.removeEventListener('pointermove', this.webReParallaxPointerMove);
                }
                this.webReParallaxNodes = null;
            },

            getRefElement(refName) {
                let ref = this.$refs[refName];
                ref = Array.isArray(ref) ? ref[0] : ref;
                return ref && ref.$el ? ref.$el : ref;
            },

            getStageSurfaceElement() {
                return this.getRefElement('stageSurface');
            },

            getPreviewViewportElement() {
                return this.getRefElement('previewViewport');
            },

            openMobileSettings() {
                this.mobileSettingsVisible = true;
                this.syncDrawerScrollLock();
                // Move keyboard/SR focus into the sheet; the FAB it came from
                // is removed by v-if the moment the drawer opens.
                this.$nextTick(() => {
                    let closeButton = this.getRefElement('drawerCloseButton');
                    if (closeButton && closeButton.focus) {
                        closeButton.focus();
                    }
                });
            },

            closeMobileSettings() {
                this.mobileSettingsVisible = false;
                this.syncDrawerScrollLock();
                this.$nextTick(() => {
                    let fab = this.getRefElement('mobileSettingsFab');
                    if (fab && fab.focus) {
                        fab.focus();
                    }
                });
            },

            toggleMobileSettings() {
                this.mobileSettingsVisible = !this.mobileSettingsVisible;
                this.syncDrawerScrollLock();
            },

            syncDrawerScrollLock() {
                // Lock the page behind the open bottom sheet.
                let locked = this.isMobile && this.mobileSettingsVisible;
                document.body.style.overflow = locked ? 'hidden' : '';
            },

            t(key, params) {
                if (this.isGpt && gpt.copy[this.language] && gpt.copy[this.language][key]) {
                    return gpt.copy[this.language][key];
                }
                let parts = key.split('.');
                let value = I18N[this.language] || I18N.zh;
                parts.forEach((part) => {
                    value = value && value[part];
                });
                if (typeof value !== 'string') {
                    value = I18N.zh;
                    parts.forEach((part) => {
                        value = value && value[part];
                    });
                }
                if (typeof value !== 'string') {
                    return key;
                }
                if (params) {
                    Object.keys(params).forEach((name) => {
                        // Function replacement: raw error text in params may
                        // contain $& / $' which String.replace would expand.
                        value = value.replace(new RegExp('\\{' + name + '\\}', 'g'), () => params[name]);
                    });
                }
                return value;
            },

            getInitialLanguage() {
                // The URL wins over both the saved preference and the browser:
                // /en/ and /ja/ are separate indexed pages whose static copy is
                // already in that language, so the UI has to match what the
                // visitor (or Googlebot) just landed on.
                let pageLanguage = window.__PAGE_LANG__;
                if (pageLanguage === 'zh' || pageLanguage === 'en' || pageLanguage === 'ja') {
                    return pageLanguage;
                }
                let savedLanguage = this.getPreference('language');
                if (savedLanguage === 'zh' || savedLanguage === 'en' || savedLanguage === 'ja') {
                    return savedLanguage;
                }
                let browserLanguage = (navigator.language || navigator.userLanguage || '').toLowerCase();
                if (browserLanguage.indexOf('ja') === 0) {
                    return 'ja';
                }
                return browserLanguage.indexOf('zh') === 0 ? 'zh' : 'en';
            },

            applyLanguage() {
                document.documentElement.lang = this.language === 'ja' ? 'ja' : (this.language === 'en' ? 'en' : 'zh-CN');
                document.title = this.t('app.title');
                let descriptionMeta = document.querySelector('meta[name="description"]');
                if (descriptionMeta) {
                    descriptionMeta.setAttribute('content', this.t('app.description'));
                }
            },

            setLanguage(language) {
                if (language !== 'zh' && language !== 'en' && language !== 'ja') {
                    return;
                }
                this.language = language;
                this.savePreference('language', language);
                this.applyLanguage();
                this.syncProgressTipLanguage();
                this.switchLanguagePage(language);
            },

            // Each language is its own indexed URL, so a switch should also move
            // the visitor there: otherwise the static copy below the app stays in
            // the previous language, and on /en/ or /ja/ a reload would snap the
            // UI back (getInitialLanguage lets the URL win). Skipped whenever an
            // image is loaded or in flight — navigating would throw that away, and
            // the in-page translation already covers the UI.
            switchLanguagePage(language) {
                if (this.isGpt) return;
                const target = language === 'en' ? '/en/' : (language === 'ja' ? '/ja/' : '/');
                const current = window.location.pathname.replace(/index\.html$/, '');
                if (current === target) {
                    return;
                }
                if (this.isProcessing || this.uploadImgSrc || this.outputImgSrc || this.batchItems.length) {
                    return;
                }
                window.location.assign(target);
            },

            getLanguageLabel() {
                if (this.language === 'zh') {
                    return '中文';
                }
                if (this.language === 'ja') {
                    return '日本語';
                }
                return 'English';
            },

            showInfoPopover() {
                this.projectInfoVisible = true;
            },

            hideInfoPopover() {
                if (!this.projectInfoPinned) {
                    this.projectInfoVisible = false;
                }
            },

            toggleInfoPopover() {
                let nextVisible = !(this.projectInfoVisible && this.projectInfoPinned);
                this.projectInfoVisible = nextVisible;
                this.projectInfoPinned = nextVisible;
            },

            closeInfoPopovers() {
                this.projectInfoVisible = false;
                this.projectInfoPinned = false;
            },

            handleInfoPopoverOutside(event) {
                if (!this.projectInfoVisible) {
                    return;
                }
                let target = event && event.target;
                if (!target || !target.closest) {
                    this.closeInfoPopovers();
                    return;
                }
                if (target.closest('.info-button') || target.closest('.info-popover')) {
                    return;
                }
                this.closeInfoPopovers();
            },

            getEffectiveTheme() {
                if (this.themeMode === 'dark' || this.themeMode === 'light') {
                    return this.themeMode;
                }
                // Reactive prop (kept in sync by the matchMedia listener) so the
                // theme toggle icon re-renders when the OS theme flips.
                return this.systemPrefersDark ? 'dark' : 'light';
            },

            applyThemeMode() {
                let effectiveTheme = this.getEffectiveTheme();
                document.documentElement.setAttribute('data-theme', effectiveTheme);
                document.documentElement.setAttribute('data-theme-mode', this.themeMode);
                // app.css has a set of `.dark ...` rules (starfield, card
                // shadows, ambient blend modes); without this class they never
                // applied and dark mode silently lost those styles.
                document.documentElement.classList.toggle('dark', effectiveTheme === 'dark');
            },

            setThemeMode(themeMode) {
                if (themeMode !== 'auto' && themeMode !== 'light' && themeMode !== 'dark') {
                    return;
                }
                let previousEffective = this.getEffectiveTheme();
                let apply = () => {
                    this.themeMode = themeMode;
                    this.savePreference('themeMode', themeMode);
                    this.applyThemeMode();
                    if (this.extractedThemeColors) {
                        this.applyExtractedThemeColors(this.extractedThemeColors);
                    }
                };
                // Circular reveal from the toggle button (View Transitions API).
                // Falls back to the plain CSS variable cross-fade elsewhere.
                let toggleButton = document.querySelector('.topnav-btn[aria-label*="' + this.t('nav.theme') + '"]');
                let willChange = (themeMode === 'dark' || themeMode === 'light')
                    ? themeMode !== previousEffective
                    : (this.systemPrefersDark ? 'dark' : 'light') !== previousEffective;
                if (!document.startViewTransition || !toggleButton || !willChange
                    || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
                    apply();
                    return;
                }
                let rect = toggleButton.getBoundingClientRect();
                let cx = rect.left + rect.width / 2;
                let cy = rect.top + rect.height / 2;
                let radius = Math.hypot(
                    Math.max(cx, window.innerWidth - cx),
                    Math.max(cy, window.innerHeight - cy)
                );
                let transition = document.startViewTransition(apply);
                transition.ready.then(() => {
                    document.documentElement.animate(
                        {clipPath: [
                            'circle(0px at ' + cx + 'px ' + cy + 'px)',
                            'circle(' + Math.ceil(radius) + 'px at ' + cx + 'px ' + cy + 'px)',
                        ]},
                        {
                            duration: 480,
                            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
                            pseudoElement: '::view-transition-new(root)',
                        }
                    );
                }).catch(() => {});
            },

            getThemeModeLabel() {
                return this.t('theme.' + this.themeMode);
            },

            getThemeIconClass() {
                return this.getEffectiveTheme() === 'dark' ? 'el-icon-moon' : 'el-icon-sunny';
            },

            syncProgressTipLanguage() {
                if (this.isProcessDone && this.procFinalCostSeconds !== null) {
                    this.progressTip = this.t('progress.done', {seconds: this.procFinalCostSeconds});
                    return;
                }
                if (this.isProcessing) {
                    this.progressTip = this.progressRate > 0 ? this.t('progress.processing') : this.t('progress.starting');
                }
            },

            // Shared tail for every model-option change: normalize combinations,
            // persist all three prefs (current values, so always safe), prefetch.
            persistModelOptions() {
                this.normalizeModelOptions();
                this.savePreference('scale', '' + this.scaleRadio);
                this.savePreference('denoise', '' + this.denoiseRadio);
                this.savePreference('modelType', this.modelTypeRadio);
                this.preloadSelectedModelAssets();
            },

            onScaleOptionChange() {
                this.persistModelOptions();
            },

            isDesignScaleHidden(scale) {
                return this.modelTypeRadio === 'pro' && scale === 4;
            },

            getVisibleDesignScales() {
                return this.modelTypeRadio === 'pro' ? [2, 3] : [2, 3, 4];
            },

            getDesignScaleBarLeft() {
                let visibleScales = this.getVisibleDesignScales();
                let index = Math.max(0, visibleScales.indexOf(this.scaleRadio));
                return index * (100 / visibleScales.length);
            },

            setDesignScale(scale) {
                if (this.isDesignScaleHidden(scale)) {
                    return;
                }
                this.scaleRadio = scale;
                this.onScaleOptionChange();
            },

            onDenoiseOptionChange() {
                this.persistModelOptions();
            },

            getDesignDenoiseOptions() {
                return [
                    {value: -1, label: this.t('denoise.conservative')},
                    {value: 0, label: this.t('denoise.none')},
                    {value: 1, label: '1'},
                    {value: 2, label: '2'},
                    {value: 3, label: '3'},
                ];
            },

            setDesignDenoise(denoise) {
                if (this.isDenoiseDisabled(denoise)) {
                    return;
                }
                this.denoiseRadio = denoise;
                this.onDenoiseOptionChange();
            },

            startDesignDenoiseScrub(event) {
                this.designDenoiseScrubbing = true;
                if (event.currentTarget.setPointerCapture) {
                    event.currentTarget.setPointerCapture(event.pointerId);
                }
                this.pickDesignDenoise(event.clientX, event.currentTarget);
            },

            moveDesignDenoiseScrub(event) {
                if (this.designDenoiseScrubbing) {
                    this.pickDesignDenoise(event.clientX, event.currentTarget);
                }
            },

            endDesignDenoiseScrub() {
                this.designDenoiseScrubbing = false;
            },

            pickDesignDenoise(clientX, element) {
                let visibleOptions = this.getDesignDenoiseOptions().filter((option) => !this.isDenoiseDisabled(option.value));
                let rect = element.getBoundingClientRect();
                let index = Math.max(0, Math.min(visibleOptions.length - 1, Math.floor(((clientX - rect.left) / rect.width) * visibleOptions.length)));
                this.setDesignDenoise(visibleOptions[index].value);
            },

            onModelTypeOptionChange() {
                this.persistModelOptions();
            },

            isDenoiseDisabled(denoise) {
                if (this.modelTypeRadio === 'pro') {
                    return denoise === 1 || denoise === 2;
                }
                if (this.scaleRadio === 2) {
                    return false;
                }
                return denoise === 1 || denoise === 2;
            },

            normalizeModelOptions() {
                if (this.modelTypeRadio === 'pro' && this.scaleRadio === 4) {
                    this.scaleRadio = 2;
                }
                if (this.isDenoiseDisabled(this.denoiseRadio)) {
                    this.denoiseRadio = 3;
                }
            },

            onBackendModeChange() {
                this.savePreference('backendMode', this.backendMode);
                if (this.wasmModuleLoaded) {
                    this.$alert(this.t('dialog.backendSavedText'), this.t('dialog.backendSavedTitle'), {
                        confirmButtonText: this.t('dialog.reload'),
                        callback: action => {
                            window.location.reload();
                        }
                    });
                }
            },

            // try/catch: merely touching window.localStorage throws SecurityError
            // when site data is blocked (Chrome setting, old Safari private mode),
            // and getPreference runs at the very top of mounted().
            // Keys carry an 'rc:' prefix to avoid collisions on shared origins;
            // reads fall back to (and migrate) the legacy bare keys.
            savePreference(key, val) {
                try {
                    localStorage.setItem('rc:' + key, val);
                } catch (error) {
                    // Storage unavailable — preferences just don't persist.
                }
            },

            getPreference(key) {
                try {
                    let value = localStorage.getItem('rc:' + key);
                    if (value !== null) {
                        return value;
                    }
                    let legacy = localStorage.getItem(key);
                    if (legacy !== null) {
                        localStorage.setItem('rc:' + key, legacy);
                        localStorage.removeItem(key);
                    }
                    return legacy;
                } catch (error) {
                    return null;
                }
            },

            clampColorValue(value, min, max) {
                return Math.max(min, Math.min(max, value));
            },

            rgbToHsl(r, g, b) {
                r /= 255;
                g /= 255;
                b /= 255;
                let max = Math.max(r, g, b);
                let min = Math.min(r, g, b);
                let h = 0;
                let s = 0;
                let l = (max + min) / 2;
                if (max !== min) {
                    let d = max - min;
                    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                    switch (max) {
                        case r:
                            h = (g - b) / d + (g < b ? 6 : 0);
                            break;
                        case g:
                            h = (b - r) / d + 2;
                            break;
                        default:
                            h = (r - g) / d + 4;
                    }
                    h /= 6;
                }
                return {h: h * 360, s: s * 100, l: l * 100};
            },

            hslToRgb(h, s, l) {
                h /= 360;
                s /= 100;
                l /= 100;
                let r;
                let g;
                let b;
                if (s === 0) {
                    r = l;
                    g = l;
                    b = l;
                } else {
                    let hueToRgb = (p, q, t) => {
                        if (t < 0) t += 1;
                        if (t > 1) t -= 1;
                        if (t < 1 / 6) return p + (q - p) * 6 * t;
                        if (t < 1 / 2) return q;
                        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                        return p;
                    };
                    let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                    let p = 2 * l - q;
                    r = hueToRgb(p, q, h + 1 / 3);
                    g = hueToRgb(p, q, h);
                    b = hueToRgb(p, q, h - 1 / 3);
                }
                return {
                    r: Math.round(r * 255),
                    g: Math.round(g * 255),
                    b: Math.round(b * 255),
                };
            },

            rgbCss(color) {
                return 'rgb(' + color.r + ', ' + color.g + ', ' + color.b + ')';
            },

            getRelativeLuminance(color) {
                let channel = (value) => {
                    value = value / 255;
                    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
                };
                return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
            },

            getReadableTextOnColor(color) {
                return this.getRelativeLuminance(color) > 0.36 ? '#111827' : '#ffffff';
            },

            getContrastingHueColor(color, background, minimumRatio) {
                let hsl = this.rgbToHsl(color.r, color.g, color.b);
                let backgroundLuminance = this.getRelativeLuminance(background);
                let direction = backgroundLuminance < 0.5 ? 1 : -1;
                let contrastRatio = (candidate) => {
                    let candidateLuminance = this.getRelativeLuminance(candidate);
                    let lighter = Math.max(candidateLuminance, backgroundLuminance);
                    let darker = Math.min(candidateLuminance, backgroundLuminance);
                    return (lighter + 0.05) / (darker + 0.05);
                };
                let candidate = color;
                for (let lightness = hsl.l; lightness >= 8 && lightness <= 92; lightness += direction * 4) {
                    candidate = this.hslToRgb(hsl.h, hsl.s, lightness);
                    if (contrastRatio(candidate) >= minimumRatio) {
                        return candidate;
                    }
                }
                return this.hslToRgb(hsl.h, hsl.s, direction > 0 ? 92 : 8);
            },

            extractThemeColors(imageData, limit) {
                let data = imageData.data;
                let pixelCount = imageData.width * imageData.height;
                let stride = Math.max(4, Math.floor(pixelCount / 6000) * 4);
                let buckets = {};
                for (let i = 0; i < data.length; i += stride) {
                    let a = data[i + 3];
                    if (a < 180) {
                        continue;
                    }
                    let r = data[i];
                    let g = data[i + 1];
                    let b = data[i + 2];
                    let hsl = this.rgbToHsl(r, g, b);
                    if (hsl.s < 18 || hsl.l < 18 || hsl.l > 88) {
                        continue;
                    }
                    let hKey = Math.round(hsl.h / 10) * 10;
                    let sKey = Math.round(hsl.s / 10) * 10;
                    let lKey = Math.round(hsl.l / 10) * 10;
                    let key = hKey + ':' + sKey + ':' + lKey;
                    let balance = 1 - Math.abs(hsl.l - 52) / 52;
                    let score = hsl.s * 1.4 + balance * 60;
                    if (!buckets[key]) {
                        buckets[key] = {r: 0, g: 0, b: 0, weight: 0, score: 0};
                    }
                    buckets[key].r += r * score;
                    buckets[key].g += g * score;
                    buckets[key].b += b * score;
                    buckets[key].weight += score;
                    buckets[key].score += score;
                }
                let ranked = Object.keys(buckets)
                    .map((key) => {
                        let bucket = buckets[key];
                        return {
                            r: Math.round(bucket.r / bucket.weight),
                            g: Math.round(bucket.g / bucket.weight),
                            b: Math.round(bucket.b / bucket.weight),
                            score: bucket.score,
                        };
                    })
                    .sort((a, b) => b.score - a.score);
                let selected = [];
                ranked.forEach((candidate) => {
                    if (selected.length >= limit) {
                        return;
                    }
                    let distinct = selected.every((color) => {
                        let delta = Math.abs(candidate.r - color.r) + Math.abs(candidate.g - color.g) + Math.abs(candidate.b - color.b);
                        return delta > 72;
                    });
                    if (distinct) {
                        selected.push(candidate);
                    }
                });
                if (selected.length === 0) {
                    selected.push({r: 64, g: 158, b: 255});
                }
                while (selected.length < limit) {
                    let base = selected[0];
                    let hsl = this.rgbToHsl(base.r, base.g, base.b);
                    let next = this.hslToRgb((hsl.h + selected.length * 38) % 360, this.clampColorValue(hsl.s, 35, 76), this.clampColorValue(hsl.l + (selected.length % 2 === 0 ? 12 : -8), 36, 72));
                    selected.push(next);
                }
                return selected.slice(0, limit);
            },

            buildThemePalette(colors, isDarkTheme) {
                let color = colors[0];
                let hsl = this.rgbToHsl(color.r, color.g, color.b);
                let primary = this.hslToRgb(hsl.h, this.clampColorValue(hsl.s, 42, 78), isDarkTheme ? this.clampColorValue(hsl.l + 4, 42, 56) : this.clampColorValue(hsl.l, 34, 52));
                let soft = this.hslToRgb(hsl.h, this.clampColorValue(hsl.s, 24, 58), isDarkTheme ? 14 : 94);
                let border = this.hslToRgb(hsl.h, this.clampColorValue(hsl.s, 20, 52), isDarkTheme ? 28 : 78);
                let textStrong = isDarkTheme ? this.hslToRgb(hsl.h, 24, 92) : this.hslToRgb(hsl.h, 28, 20);
                let readyBadge = this.getContrastingHueColor(primary, {r: 20, g: 12, b: 24}, 4.5);
                let fluidColors = colors.map((themeColor) => {
                    let colorHsl = this.rgbToHsl(themeColor.r, themeColor.g, themeColor.b);
                    let fluid = this.hslToRgb(colorHsl.h, this.clampColorValue(colorHsl.s, 45, 82), isDarkTheme ? this.clampColorValue(colorHsl.l - 8, 28, 50) : this.clampColorValue(colorHsl.l, 46, 68));
                    return 'rgba(' + fluid.r + ', ' + fluid.g + ', ' + fluid.b + ', ' + (isDarkTheme ? '0.66' : '0.72') + ')';
                });
                return {
                    primary: this.rgbCss(primary),
                    soft: this.rgbCss(soft),
                    border: this.rgbCss(border),
                    surfaceTint: 'rgba(' + primary.r + ', ' + primary.g + ', ' + primary.b + ', ' + (isDarkTheme ? '0.14' : '0.08') + ')',
                    textStrong: this.rgbCss(textStrong),
                    onPrimary: this.getReadableTextOnColor(primary),
                    readyBadge: this.rgbCss(readyBadge),
                    fluidColors: fluidColors,
                };
            },

            applyThemePalette(palette) {
                let root = document.documentElement;
                root.style.setProperty('--theme-primary', palette.primary);
                root.style.setProperty('--theme-primary-soft', palette.soft);
                root.style.setProperty('--theme-primary-border', palette.border);
                root.style.setProperty('--theme-surface-tint', palette.surfaceTint);
                root.style.setProperty('--theme-text-strong', palette.textStrong);
                root.style.setProperty('--theme-on-primary', palette.onPrimary);
                palette.fluidColors.forEach((color, index) => {
                    root.style.setProperty('--fluid-color-' + (index + 1), color);
                });
                root.style.setProperty('--c-primary', palette.primary);
                root.style.setProperty('--c-on-primary', palette.onPrimary);
                root.style.setProperty('--c-secondary', palette.fluidColors[1] || palette.fluidColors[0] || palette.primary);
                root.style.setProperty('--c-tertiary', palette.fluidColors[2] || palette.fluidColors[0] || palette.primary);
                root.style.setProperty('--c-surface-tint', palette.primary);
                root.style.setProperty('--brand-suffix-color', palette.primary);
                root.style.setProperty('--ready-badge-color', palette.readyBadge);
            },

            applyImageTheme(imageData) {
                let colors = this.extractThemeColors(imageData, 4);
                this.extractedThemeColors = colors;
                this.applyExtractedThemeColors(colors);
            },

            applyExtractedThemeColors(colors) {
                let isDarkTheme = this.getEffectiveTheme() === 'dark';
                this.applyThemePalette(this.buildThemePalette(colors, isDarkTheme));
            },

            resetTheme() {
                [
                    '--theme-primary',
                    '--theme-primary-soft',
                    '--theme-primary-border',
                    '--theme-surface-tint',
                    '--theme-text-strong',
                    '--theme-on-primary',
                    '--fluid-color-1',
                    '--fluid-color-2',
                    '--fluid-color-3',
                    '--fluid-color-4',
                    '--c-primary',
                    '--c-on-primary',
                    '--c-secondary',
                    '--c-tertiary',
                    '--c-surface-tint',
                    '--brand-suffix-color',
                    '--ready-badge-color',
                ].forEach((name) => document.documentElement.style.removeProperty(name));
                this.extractedThemeColors = null;
            },

            getModelTypeCode(modelType) {
                return modelType === 'pro' ? 1 : 0;
            },

            getDenoiseLabel(denoise) {
                if (denoise === -1) {
                    return this.t('denoise.conservative');
                }
                if (denoise === 0) {
                    return this.t('denoise.none');
                }
                return denoise + 'X';
            },

            getModelDisplayName(scale, denoise, modelType) {
                return this.t('model.' + modelType) + ' ' + scale + 'X / ' + this.getDenoiseLabel(denoise);
            },

            getSelectedModelFiles(scale, denoise, modelType) {
                let modelSet = MODEL_FILES[modelType];
                let denoiseSet = modelSet && modelSet['' + denoise];
                let files = denoiseSet && denoiseSet[scale];
                if (!files) {
                    throw new Error('model_manifest_missing: ' + modelType + ' scale=' + scale + ' denoise=' + denoise);
                }
                return {
                    key: modelType + ':' + scale + ':' + denoise,
                    label: this.getModelDisplayName(scale, denoise, modelType),
                    param: files.param,
                    bin: files.bin,
                    paramBytes: files.paramBytes,
                    binBytes: files.binBytes,
                };
            },

            formatModelLoadingTip(files, file, progress) {
                if (files && files.label && file) {
                    return this.t('progress.loadingModelFile', {
                        model: files.label,
                        file: file,
                        percent: progress,
                    });
                }
                return this.t('progress.loadingModel', {percent: progress});
            },

            startModelLoading(files, progress, file) {
                this.feedProcessWatchdog();
                this.modelLoadingProgress = progress;
                this.modelLoadingName = files && files.label ? files.label : '';
                this.modelLoadingFile = file || '';
                if (this.modelLoading) {
                    this.progressTip = this.formatModelLoadingTip(files, file, progress);
                    return;
                }
                if (!this.modelLoadingTimer) {
                    this.modelLoadingTimer = setTimeout(() => {
                        this.modelLoadingTimer = null;
                        if (!this.modelLoadingName && !this.modelLoadingFile) {
                            return;
                        }
                        this.modelLoading = true;
                        this.progressTip = this.formatModelLoadingTip(
                            {label: this.modelLoadingName},
                            this.modelLoadingFile,
                            this.modelLoadingProgress
                        );
                    }, 120);
                }
            },

            finishModelLoading() {
                if (this.modelLoadingTimer) {
                    clearTimeout(this.modelLoadingTimer);
                    this.modelLoadingTimer = null;
                }
                this.modelLoading = false;
                this.modelLoadingProgress = 0;
                this.modelLoadingName = '';
                this.modelLoadingFile = '';
            },

            async fetchModelAsset(path, expectedBytes, progress, files) {
                this.startModelLoading(files, Math.max(0, progress - 10), path);
                const bytes = await this.fetchModelAssetBytes(path, expectedBytes);
                this.modelLoadingProgress = progress;
                if (this.modelLoading) {
                    this.progressTip = this.formatModelLoadingTip(files, path, progress);
                }
                return bytes;
            },

            async fetchModelAssetBytes(path, expectedBytes) {
                const response = await fetch(this.versionedUrl('models/' + path), {cache: 'force-cache'});
                if (!response.ok) {
                    throw new Error('model_file_not_found: ' + path);
                }
                const contentLength = Number(response.headers.get('content-length')) || 0;
                if (contentLength && expectedBytes && contentLength !== expectedBytes) {
                    throw new Error('model_file_size_mismatch: ' + path + ' expected=' + expectedBytes + ' actual=' + contentLength);
                }
                const buffer = await response.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                if (expectedBytes && bytes.length !== expectedBytes) {
                    throw new Error('model_file_size_mismatch: ' + path + ' expected=' + expectedBytes + ' actual=' + bytes.length);
                }
                return bytes;
            },

            getModelAssetCacheEntry(files) {
                let entry = this.modelAssetCache[files.key];
                if (entry) {
                    return entry;
                }
                entry = {
                    files: files,
                    promise: Promise.all([
                        this.fetchModelAssetBytes(files.param, files.paramBytes),
                        this.fetchModelAssetBytes(files.bin, files.binBytes),
                    ]).then(([paramBytes, binBytes]) => ({
                        files: files,
                        paramBytes: paramBytes,
                        binBytes: binBytes,
                    })).catch((error) => {
                        delete this.modelAssetCache[files.key];
                        throw error;
                    }),
                };
                this.modelAssetCache[files.key] = entry;
                return entry;
            },

            preloadModelAssets(scale, denoise, modelType) {
                let files;
                try {
                    files = this.getSelectedModelFiles(scale, denoise, modelType);
                } catch (error) {
                    return Promise.resolve(null);
                }
                return this.getModelAssetCacheEntry(files).promise.catch((error) => {
                    Logger.warn('model preload skipped:', error);
                    return null;
                });
            },

            preloadSelectedModelAssets() {
                if (this.isGpt) return Promise.resolve(null);
                return this.preloadModelAssets(this.scaleRadio, this.denoiseRadio, this.modelTypeRadio);
            },

            ensureModelDirectory(path) {
                let slashIndex = path.lastIndexOf('/');
                if (slashIndex <= 0) {
                    return '/';
                }
                let dir = path.substring(0, slashIndex);
                try {
                    Module.FS_createPath('/', dir, true, true);
                } catch (error) {
                    // Directory already exists.
                }
                return '/' + dir;
            },

            writeModelFile(path, bytes) {
                let dir = this.ensureModelDirectory(path);
                let name = path.substring(path.lastIndexOf('/') + 1);
                let fsPath = '/' + path;
                try {
                    Module.FS_unlink(fsPath);
                } catch (error) {
                    // File is not present yet.
                }
                Module.FS_createDataFile(dir, name, bytes, true, true, true);
            },

            unloadPreviousModelFiles(nextFiles) {
                Object.keys(this.loadedModelFiles).forEach((path) => {
                    if (path === nextFiles.param || path === nextFiles.bin) {
                        return;
                    }
                    try {
                        Module.FS_unlink('/' + path);
                    } catch (error) {
                        // The file may already have been removed by a previous failed load.
                    }
                    delete this.loadedModelFiles[path];
                });
            },

            async ensureSelectedModelLoaded(scale, denoise, modelType) {
                let files = this.getSelectedModelFiles(scale, denoise, modelType);
                if (this.loadedModelKey === files.key &&
                    this.loadedModelFiles[files.param] &&
                    this.loadedModelFiles[files.bin]) {
                    return files;
                }

                this.startModelLoading(files, 0, files.param);
                const assets = await this.getModelAssetCacheEntry(files).promise;
                const paramBytes = assets.paramBytes;
                const binBytes = assets.binBytes;
                this.modelLoadingProgress = 90;
                if (this.modelLoading) {
                    this.progressTip = this.formatModelLoadingTip(files, files.bin, 90);
                }
                this.writeModelFile(files.param, paramBytes);
                this.writeModelFile(files.bin, binBytes);
                this.unloadPreviousModelFiles(files);
                this.loadedModelFiles[files.param] = true;
                this.loadedModelFiles[files.bin] = true;
                this.loadedModelKey = files.key;
                this.startModelLoading(files, 100, files.bin);
                this.finishModelLoading();
                return files;
            },

            onUploadChange(file, fileList) {
                if (!file || !file.raw) {
                    return;
                }
                this.pendingUploadFile = file;
                this.pendingUploadFileList = (fileList || []).slice();
                if (this.batchSelectionTimer) {
                    clearTimeout(this.batchSelectionTimer);
                }
                this.batchSelectionTimer = setTimeout(() => {
                    let selectedFile = this.pendingUploadFile;
                    let selectedList = this.pendingUploadFileList;
                    this.batchSelectionTimer = null;
                    this.pendingUploadFile = null;
                    this.pendingUploadFileList = [];
                    if (selectedList && selectedList.length > 1) {
                        this.startBatchProcess(selectedList);
                        return;
                    }
                    this.preloadSelectedModelAssets();
                    this.ensureWasmLoaded()
                        .then(() => this.readUploadedFile(selectedFile))
                        .catch(() => {
                            if (this.$refs.imageUpload) {
                                this.$refs.imageUpload.clearFiles();
                            }
                        });
                }, 120);
            },

            readUploadedFile(file) {
                let canvas = document.getElementById('canvas-upload');
                this.loadImageFileToCanvas(file, canvas)
                    .then(() => {
                        this.scheduleStageLayoutSync();
                        this.scrollStageIntoView();
                        this.progressTip = '';
                    })
                    .catch((error) => {
                        this.clearUploadPreviewUrl();
                        this.handleProcessFailure(error || 'failed to decode input image');
                    });
            },

            loadImageFileToCanvas(file, canvas, options) {
                options = options || {};
                return new Promise((resolve, reject) => {
                    if (!file || !file.raw) {
                        reject(new Error('missing input file'));
                        return;
                    }
                    if (this.isGpt && (file.raw.size > 40 * 1024 * 1024 || !/^image\//.test(file.raw.type))) {
                        reject(new Error(this.t('gpt.fileError'))); return;
                    }
                    let ctx = canvas.getContext('2d');
                    if (!options.keepUploadUrl) {
                        this.clearUploadPreviewUrl();
                    }
                    this.uploadObjectUrl = options.objectUrl || URL.createObjectURL(file.raw);
                    this.uploadImgSrc = this.uploadObjectUrl;
                    let img = new Image();
                    img.onload = () => {
                        canvas.width = img.naturalWidth || img.width;
                        canvas.height = img.naturalHeight || img.height;
                        if (!canvas.width || !canvas.height) {
                            // e.g. SVG without intrinsic size: drawImage from a
                            // 0x0 canvas throws later inside theme sampling and
                            // the promise would never settle.
                            reject(new Error('failed to decode input image'));
                            return;
                        }
                        if (this.isGpt && (canvas.width > 4096 || canvas.height > 4096 || canvas.width * canvas.height > 4000000)) {
                            canvas.width = canvas.height = 0;
                            reject(new Error(this.t('gpt.sizeError'))); return;
                        }
                        ctx.drawImage(img, 0, 0);
                        this.uploadPreviewWidth = canvas.width;
                        this.uploadPreviewHeight = canvas.height;
                        this.uploadPreviewName = file.name;
                        this.applyImageThemeFromCanvas(canvas);
                        this.buildWebReDots(canvas);
                        resolve();
                    };
                    img.onerror = () => {
                        reject(new Error('failed to decode input image'));
                    };
                    img.src = this.uploadObjectUrl;
                });
            },

            getGptRecipe() {
                return this.gptMethod === 'l0' ? this.t('gpt.l0Recipe') : `${this.gptDown}% → ESRGAN 4× → ${this.t('gpt.originalSize')} → L0`;
            },

            getReadyWipeLines() {
                if (this.isGpt) return [
                    `${this.uploadPreviewWidth}×${this.uploadPreviewHeight} → ${this.uploadPreviewWidth}×${this.uploadPreviewHeight}`,
                    this.getGptRecipe(),
                    `L0 λ = ${this.gptLambda}`,
                ];
                return [
                    `${this.scaleRadio}X：${this.uploadPreviewWidth}×${this.uploadPreviewHeight} → ${this.uploadPreviewWidth * this.scaleRadio}×${this.uploadPreviewHeight * this.scaleRadio}`,
                    `${this.getDenoiseLabel(this.denoiseRadio)} ${this.t('controls.denoise')}`,
                    `${this.modelTypeRadio === 'pro' ? this.t('model.pro') : this.t('model.se')} ${this.t('controls.model')}`,
                ];
            },

            startReadyProcess() {
                if (!this.uploadPreviewWidth || this.isProcessing || this.isProcessDone) {
                    return;
                }
                let canvas = document.getElementById('canvas-upload');
                this.preflightProcess(canvas, canvas.width, canvas.height).catch((error) => {
                    // Covers both 'processing cancelled before start' (declined
                    // the size-risk dialog) and 'processing cancelled' (user hit
                    // cancel mid-run) — neither is a failure to report.
                    if (error && error.message && error.message.indexOf('processing cancelled') === 0) {
                        return;
                    }
                    this.handleProcessFailure(error || 'failed to start processing');
                });
            },

            buildWebReDots(sourceCanvas) {
                // Half density on mobile: 912 animated blurred dots compete with
                // the WASM worker for CPU/GPU exactly while it is saturated.
                const width = this.isMobile ? 19 : 38;
                const height = this.isMobile ? 12 : 24;
                const sample = document.createElement('canvas');
                sample.width = width;
                sample.height = height;
                const context = sample.getContext('2d', {willReadFrequently: true});
                context.drawImage(sourceCanvas, 0, 0, width, height);
                const pixels = context.getImageData(0, 0, width, height).data;
                const dots = [];
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const offset = (y * width + x) * 4;
                        const nx = x / (width - 1);
                        const ny = y / (height - 1);
                        const distance = Math.hypot(nx - 0.5, ny - 0.5) * Math.SQRT2;
                        dots.push({
                            color: `rgb(${pixels[offset]}, ${pixels[offset + 1]}, ${pixels[offset + 2]})`,
                            nx: nx,
                            ny: ny,
                            delay: Number((distance * 0.75).toFixed(3)),
                        });
                    }
                }
                // Freeze so Vue skips reactive observation of ~900 static dot objects.
                this.designDots = Object.freeze(dots);
                sample.width = 0;
                sample.height = 0;
            },

            startProcessAndWait(sourceCanvas, w, h) {
                return new Promise((resolve, reject) => {
                    this.processCompletionResolve = resolve;
                    this.processCompletionReject = reject;
                    let processPromise = this.process(sourceCanvas, w, h);
                    if (processPromise && processPromise.catch) {
                        processPromise.catch((error) => {
                            this.rejectCurrentProcess(error);
                        });
                    }
                });
            },

            resolveCurrentProcess(result) {
                let resolve = this.processCompletionResolve;
                this.processCompletionResolve = null;
                this.processCompletionReject = null;
                if (resolve) {
                    resolve(result);
                }
            },

            rejectCurrentProcess(error) {
                let reject = this.processCompletionReject;
                this.processCompletionResolve = null;
                this.processCompletionReject = null;
                if (reject) {
                    reject(error || new Error('processing failed'));
                }
            },

            startBatchProcess(fileList) {
                let files = (fileList || [])
                    .map((file) => file && file.raw ? file : null)
                    .filter(Boolean);
                if (files.length <= 1) {
                    return;
                }
                if (this.isProcessing || this.isBatchProcessing) {
                    this.$notify({
                        title: this.t('notify.busy'),
                        message: this.t('batch.busy'),
                        type: 'warning'
                    });
                    return;
                }
                this.preloadSelectedModelAssets();
                this.ensureWasmLoaded()
                    .then(() => this.runBatchQueue(files))
                    .catch(() => {
                        if (this.$refs.imageUpload) {
                            this.$refs.imageUpload.clearFiles();
                        }
                    });
            },

            async runBatchQueue(files) {
                this.resetWorkspace({keepBatch: true});
                // Revoke the previous batch's object URLs before replacing
                // batchItems; resetWorkspace({keepBatch: true}) skips this.
                this.clearBatchResults();
                this.batchRunId += 1;
                let runId = this.batchRunId;
                this.isBatchActive = true;
                this.isBatchProcessing = true;
                this.batchCancelRequested = false;
                this.batchItems = files.map((file, index) => ({
                    id: runId + '-' + index,
                    file: file,
                    name: file.name,
                    status: 'pending',
                    previewObjectUrl: URL.createObjectURL(file.raw),
                    inputWidth: 0,
                    inputHeight: 0,
                    outputWidth: 0,
                    outputHeight: 0,
                    outputScale: 0,
                    outputDenoise: 0,
                    outputModelType: 'se',
                    accentColor: '',
                    accentSoftColor: '',
                    accentTextColor: '',
                    filename: '',
                    objectUrl: '',
                }));
                this.selectedBatchItemId = this.batchItems.length ? this.batchItems[0].id : null;
                this.progressTip = this.t('batch.queued', {total: this.batchItems.length});
                this.scheduleStageLayoutSync();

                // Snapshot the model options: every item in this batch processes
                // with the settings from when it started, even if the user
                // changes the controls mid-run (they'd otherwise silently apply
                // to the remaining items — inconsistent output, and a mid-batch
                // jump to 4X can OOM).
                let batchOptions = {
                    scale: this.scaleRadio,
                    denoise: this.denoiseRadio,
                    modelType: this.modelTypeRadio,
                    gptMethod: this.gptMethod,
                    gptDown: this.gptDown,
                    gptLambda: this.gptLambda,
                };

                let canvas = document.getElementById('canvas-upload');
                for (let index = 0; index < this.batchItems.length; index++) {
                    if (this.batchCancelRequested || runId !== this.batchRunId) {
                        break;
                    }
                    // Restore the snapshot before each item; the controls visibly
                    // snap back, signalling that batch settings are locked.
                    this.scaleRadio = batchOptions.scale;
                    this.denoiseRadio = batchOptions.denoise;
                    this.modelTypeRadio = batchOptions.modelType;
                    this.gptMethod = batchOptions.gptMethod;
                    this.gptDown = batchOptions.gptDown;
                    this.gptLambda = batchOptions.gptLambda;
                    let item = this.batchItems[index];
                    this.activeBatchItemId = item.id;
                    this.selectedBatchItemId = item.id;
                    item.status = 'processing';
                    this.progressTip = this.t('batch.processing', {
                        current: index + 1,
                        total: this.batchItems.length,
                        name: item.name,
                    });
                    try {
                        await this.loadImageFileToCanvas(item.file, canvas, {
                            keepUploadUrl: true,
                            objectUrl: item.previewObjectUrl,
                        });
                        item.inputWidth = canvas.width;
                        item.inputHeight = canvas.height;
                        this.applyBatchItemAccentFromCanvas(item, canvas);
                        this.scheduleStageLayoutSync();
                        this.scrollStageIntoView();
                        await this.preflightProcess(canvas, canvas.width, canvas.height);
                        item.status = 'done';
                    } catch (error) {
                        if (this.batchCancelRequested || this.isCancelling) {
                            item.status = 'cancelled';
                            break;
                        }
                        item.status = 'error';
                        Logger.error('batch item failed:', item.name, error);
                    }
                }

                this.isBatchProcessing = false;
                this.activeBatchItemId = null;
                if (this.batchCancelRequested) {
                    // Items never reached stay "pending" forever otherwise,
                    // which reads as "still queued" after a cancel.
                    this.batchItems.forEach((entry) => {
                        if (entry.status === 'pending') {
                            entry.status = 'cancelled';
                        }
                    });
                    this.progressTip = this.t('batch.cancelled');
                } else {
                    let failedCount = this.batchItems.filter((entry) => entry.status === 'error').length;
                    this.progressTip = this.t(failedCount ? 'batch.doneWithErrors' : 'batch.done', {
                        done: this.batchDoneCount,
                        total: this.batchItems.length,
                        failed: failedCount,
                    });
                    this.$notify({
                        title: this.t('notify.success'),
                        message: this.progressTip,
                        type: failedCount ? 'warning' : 'success'
                    });
                }
                if (this.$refs.imageUpload) {
                    this.$refs.imageUpload.clearFiles();
                }
            },

            getOutputFilename() {
                if (this.isGpt) return (this.uploadPreviewName || 'image').replace(/\.[^.]+$/, '') + '-denoise.png';
                let filename = "realcugan-output";
                if (this.uploadPreviewName && this.uploadPreviewName.length > 0) {
                    filename = this.uploadPreviewName.replace(/\.[^/.]+$/, "");
                }
                filename += "-" + this.outputModelType + "-up" + this.outputScale + "x";
                switch (this.outputDenoise) {
                    case -1:
                        filename += "-conservative.png";
                        break;
                    case 1:
                        filename += "-denoise1x.png";
                        break;
                    case 2:
                        filename += "-denoise2x.png";
                        break;
                    case 3:
                        filename += "-denoise3x.png";
                        break;
                    default:
                        filename += "-no-denoise.png";
                }
                return filename;
            },

            rememberBatchResult(objectUrl, outputWidth, outputHeight) {
                if (!this.isBatchActive || !this.activeBatchItemId || !objectUrl) {
                    return;
                }
                let item = this.batchItems.find((entry) => entry.id === this.activeBatchItemId);
                if (!item) {
                    return;
                }
                item.filename = this.getOutputFilename();
                item.objectUrl = objectUrl;
                item.outputWidth = outputWidth || this.outputPreviewWidth;
                item.outputHeight = outputHeight || this.outputPreviewHeight;
                item.outputScale = this.outputScale;
                item.outputDenoise = this.outputDenoise;
                item.outputModelType = this.outputModelType;
            },

            selectBatchItem(item) {
                if (!item) {
                    return;
                }
                this.selectedBatchItemId = item.id;
                if (!item.inputWidth || !item.inputHeight) {
                    return;
                }
                this.uploadPreviewName = item.name;
                this.uploadPreviewWidth = item.inputWidth;
                this.uploadPreviewHeight = item.inputHeight;
                this.uploadImgSrc = item.previewObjectUrl || '';
                this.uploadObjectUrl = item.previewObjectUrl || '';
                this.outputScale = item.outputScale || (this.isGpt ? 1 : this.scaleRadio);
                // outputScale doubles as the "has a stored result" sentinel
                // (0 until processed): plain `||` would drop denoise 0 ("none")
                // and -1 ("conservative") for processed items.
                this.outputDenoise = item.outputScale ? item.outputDenoise : this.denoiseRadio;
                this.outputModelType = item.outputModelType || this.modelTypeRadio;
                this.outputPreviewWidth = item.outputWidth || item.inputWidth * this.outputScale;
                this.outputPreviewHeight = item.outputHeight || item.inputHeight * this.outputScale;
                this.outputImgSrc = item.objectUrl || '';
                this.outputObjectUrl = item.objectUrl || '';
                this.isProcessDone = item.status === 'done' && !!item.objectUrl;
                this.isResultRevealing = false;
                this.previewOverlapRate = 50;
                this.previewZoom = this.previewZoomMin;
                this.resetPreviewPan();
                this.scheduleStageLayoutSync();
                this.syncPreviewViewport();
            },

            downloadBatchItem(item) {
                if (!item || !item.objectUrl) {
                    return;
                }
                this.triggerDownload(item.objectUrl, item.filename);
            },

            // Re-run a single failed/cancelled batch item without redoing the
            // whole batch. Mirrors the per-item steps of runBatchQueue.
            async retryBatchItem(item) {
                if (!item || !item.file || this.isProcessing || this.isBatchProcessing) {
                    return;
                }
                this.isBatchProcessing = true;
                this.batchCancelRequested = false;
                this.activeBatchItemId = item.id;
                this.selectedBatchItemId = item.id;
                item.status = 'processing';
                this.progressTip = this.t('batch.processing', {
                    current: 1,
                    total: 1,
                    name: item.name,
                });
                let canvas = document.getElementById('canvas-upload');
                try {
                    await this.loadImageFileToCanvas(item.file, canvas, {
                        keepUploadUrl: true,
                        objectUrl: item.previewObjectUrl,
                    });
                    item.inputWidth = canvas.width;
                    item.inputHeight = canvas.height;
                    this.applyBatchItemAccentFromCanvas(item, canvas);
                    this.scheduleStageLayoutSync();
                    this.scrollStageIntoView();
                    await this.preflightProcess(canvas, canvas.width, canvas.height);
                    item.status = 'done';
                } catch (error) {
                    item.status = this.isCancelling || this.batchCancelRequested ? 'cancelled' : 'error';
                    Logger.error('batch item retry failed:', item.name, error);
                } finally {
                    this.isBatchProcessing = false;
                    this.activeBatchItemId = null;
                    this.progressTip = this.t('batch.done', {
                        done: this.batchDoneCount,
                        total: this.batchItems.length,
                    });
                }
            },

            async downloadAllBatchResults() {
                let items = this.batchItems.filter((item) => item.objectUrl);
                if (!items.length) {
                    return;
                }
                try {
                    // One ZIP instead of N sequential a.click() downloads, which
                    // Safari drops and Chrome gates behind a permission prompt.
                    let entries = await Promise.all(items.map(async (item) => {
                        let response = await fetch(item.objectUrl);
                        let buffer = await response.arrayBuffer();
                        return {name: item.filename, bytes: new Uint8Array(buffer)};
                    }));
                    // Duplicate names would silently overwrite inside the zip.
                    let seen = {};
                    entries.forEach((entry) => {
                        let original = entry.name;
                        let count = seen[original] || 0;
                        seen[original] = count + 1;
                        if (count > 0) {
                            entry.name = original.replace(/(\.[a-z0-9]+)?$/i, '-' + count + '$1');
                        }
                    });
                    let zipBlob = window.buildStoreZip(entries, new Date());
                    let zipUrl = URL.createObjectURL(zipBlob);
                    this.triggerDownload(zipUrl, 'realcugan-batch.zip');
                    setTimeout(() => URL.revokeObjectURL(zipUrl), 60000);
                } catch (error) {
                    Logger.error('zip download failed, falling back to sequential:', error);
                    items.forEach((item, index) => {
                        setTimeout(() => this.downloadBatchItem(item), index * 300);
                    });
                }
            },

            triggerDownload(objectUrl, filename) {
                var a = document.getElementById("download-link");
                a.href = objectUrl;
                a.download = filename;
                a.click();
            },

            getBatchTagType(status) {
                if (status === 'done') {
                    return 'success';
                }
                if (status === 'error') {
                    return 'danger';
                }
                if (status === 'processing') {
                    return 'warning';
                }
                return 'info';
            },

            getBatchItemStyle(item) {
                return {
                    width: 'calc(100% - 2px)',
                    maxWidth: 'calc(100% - 2px)',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    marginRight: '0',
                    flexShrink: '0',
                };
            },

            getBatchDownloadButtonStyle(item) {
                let fallbackAccent = 'var(--theme-primary)';
                let fallbackSoft = 'var(--theme-primary-soft)';
                let fallbackText = 'var(--theme-on-primary)';
                if (!item || !item.accentColor) {
                    return {
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '28px',
                        height: '28px',
                        minWidth: '28px',
                        padding: '0',
                        borderRadius: '50%',
                        background: fallbackAccent,
                        boxShadow: 'none',
                        color: fallbackText,
                    };
                }
                return {
                    '--batch-download-accent': item.accentColor,
                    '--batch-download-soft': item.accentSoftColor || item.accentColor,
                    '--batch-download-on-accent': item.accentTextColor || '#ffffff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '28px',
                    height: '28px',
                    minWidth: '28px',
                    padding: '0',
                    borderRadius: '50%',
                    borderColor: item.accentColor,
                    background: item.accentColor,
                    boxShadow: 'none',
                    color: item.accentTextColor || '#ffffff',
                };
            },

            applyBatchItemAccentFromCanvas(item, sourceCanvas) {
                if (!item || !sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) {
                    return;
                }
                const sample = this.getCanvasThemeSample(sourceCanvas);
                const colors = this.extractThemeColors(sample.imageData, 1);
                sample.canvas.width = 0;
                sample.canvas.height = 0;
                const color = colors[0] || {r: 64, g: 158, b: 255};
                const hsl = this.rgbToHsl(color.r, color.g, color.b);
                const accent = this.hslToRgb(hsl.h, this.clampColorValue(hsl.s, 46, 82), this.clampColorValue(hsl.l, 34, 56));
                const soft = this.hslToRgb(hsl.h, this.clampColorValue(hsl.s, 28, 64), this.getEffectiveTheme() === 'dark' ? 22 : 92);
                item.accentColor = this.rgbCss(accent);
                item.accentSoftColor = this.rgbCss(soft);
                item.accentTextColor = this.getReadableTextOnColor(accent);
            },

            applyImageThemeFromCanvas(sourceCanvas) {
                const sample = this.getCanvasThemeSample(sourceCanvas);
                this.applyImageTheme(sample.imageData);
                sample.canvas.width = 0;
                sample.canvas.height = 0;
            },

            getCanvasThemeSample(sourceCanvas) {
                const maxSampleSize = 96;
                const scale = Math.min(1, maxSampleSize / Math.max(sourceCanvas.width, sourceCanvas.height));
                const sampleWidth = Math.max(1, Math.round(sourceCanvas.width * scale));
                const sampleHeight = Math.max(1, Math.round(sourceCanvas.height * scale));
                const sampleCanvas = document.createElement('canvas');
                sampleCanvas.width = sampleWidth;
                sampleCanvas.height = sampleHeight;
                const sampleContext = sampleCanvas.getContext('2d', {willReadFrequently: true});
                sampleContext.drawImage(sourceCanvas, 0, 0, sampleWidth, sampleHeight);
                return {
                    canvas: sampleCanvas,
                    imageData: sampleContext.getImageData(0, 0, sampleWidth, sampleHeight),
                };
            },

            preflightProcess(sourceCanvas, w, h) {
                if (this.isGpt) {
                    try {
                        gpt.validate(this, w, h);
                        return this.startProcessAndWait(sourceCanvas, w, h);
                    } catch (error) { return Promise.reject(error); }
                }
                let risk = this.getProcessingRisk(w, h, this.scaleRadio);
                let outputPixels = (w * this.scaleRadio) * (h * this.scaleRadio);
                let overCanvasLimit = outputPixels > this.getCanvasPixelLimit() || w * h > this.getCanvasPixelLimit();
                if (this.isBatchProcessing) {
                    // Batch runs unattended: never show per-item dialogs. Items
                    // over the hard canvas limit fail (guaranteed-corrupt output);
                    // warn-level items proceed as if the user chose "continue".
                    if (overCanvasLimit) {
                        return Promise.reject(new Error('image exceeds platform canvas limit'));
                    }
                    return this.startProcessAndWait(sourceCanvas, w, h);
                }
                if (overCanvasLimit) {
                    // Hard block: above the platform canvas limit the output is
                    // guaranteed corrupt, so "continue anyway" must not be offered.
                    return this.$confirm(this.getSizeRiskMessageHtml(risk), this.t('dialog.sizeRiskTitle'), {
                        confirmButtonText: this.t('dialog.safeSettings'),
                        cancelButtonText: this.t('dialog.ok'),
                        type: 'error',
                        dangerouslyUseHTMLString: true,
                        showCancelButton: true,
                    }).then(() => {
                        this.applySafeProcessingSettings();
                        if ((w * this.scaleRadio) * (h * this.scaleRadio) > this.getCanvasPixelLimit()) {
                            // Even SE / 2X still exceeds the limit — the input is too large.
                            throw new Error('processing cancelled before start');
                        }
                        return this.startProcessAndWait(sourceCanvas, w, h);
                    }).catch((error) => {
                        if (error instanceof Error) {
                            throw error;
                        }
                        throw new Error('processing cancelled before start');
                    });
                }
                if (risk.level === 'ok' || this.getPreference('skipSizeRiskWarning') === '1') {
                    return this.startProcessAndWait(sourceCanvas, w, h);
                }
                let skipWarning = false;
                return this.$confirm(this.getSizeRiskMessageHtml(risk), this.t('dialog.sizeRiskTitle'), {
                        confirmButtonText: this.t('dialog.safeSettings'),
                        cancelButtonText: this.t('dialog.continue'),
                        type: 'warning',
                        distinguishCancelAndClose: true,
                        dangerouslyUseHTMLString: true,
                        beforeClose: (action, instance, done) => {
                            let checkbox = document.getElementById('size-risk-skip-checkbox');
                            skipWarning = !!(checkbox && checkbox.checked);
                            done();
                        },
                }).then(() => {
                    if (skipWarning) {
                        this.savePreference('skipSizeRiskWarning', '1');
                    }
                    this.applySafeProcessingSettings();
                    return this.startProcessAndWait(sourceCanvas, w, h);
                }).catch((action) => {
                    if (skipWarning) {
                        this.savePreference('skipSizeRiskWarning', '1');
                    }
                    if (action === 'cancel') {
                        return this.startProcessAndWait(sourceCanvas, w, h);
                    }
                    throw new Error('processing cancelled before start');
                });
            },

            // Narrow-viewport check for UI behaviors only (popover placement,
            // scroll-into-view). Memory/runtime decisions use isMobileDevice()
            // instead; the CSS layout breakpoints are 1120/640 in app.css.
            isMobileViewport() {
                return this.windowWidth <= 768;
            },

            isIOSDevice() {
                // iPadOS 13+ masquerades as MacIntel; distinguish via touch points.
                return /iPhone|iPad|iPod/.test(navigator.userAgent)
                    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            },

            isMobileDevice() {
                // Capability-based: viewport width misclassifies landscape phones and tablets.
                return this.isIOSDevice() || /Android|Mobile/i.test(navigator.userAgent);
            },

            getDeviceMemoryGiB(isMobileDevice) {
                let reported = Number(navigator.deviceMemory) || (isMobileDevice ? 4 : 8);
                let clamped = Math.max(2, Math.min(8, reported));
                // Safari never implements navigator.deviceMemory; without the clamp
                // iOS devices would default to 8 GiB and skip every memory warning.
                return this.isIOSDevice() ? Math.min(clamped, 4) : clamped;
            },

            getCanvasPixelLimit() {
                // iOS Safari silently blanks canvases above ~16.7M px (4096x4096).
                return this.isIOSDevice() ? 16777216 : Infinity;
            },

            scrollStageIntoView() {
                if (!this.isMobileViewport()) {
                    return;
                }
                this.$nextTick(() => {
                    let stage = this.getRefElement('stagePanel');
                    if (stage && stage.scrollIntoView) {
                        stage.scrollIntoView({behavior: 'smooth', block: 'start'});
                    }
                });
            },

            applySafeProcessingSettings() {
                this.modelTypeRadio = 'se';
                this.scaleRadio = 2;
                this.safeProcessingMode = true;
                this.normalizeModelOptions();
                this.savePreference('modelType', this.modelTypeRadio);
                this.savePreference('scale', '' + this.scaleRadio);
                this.savePreference('denoise', '' + this.denoiseRadio);
            },

            escapeHtml(value) {
                return (value + '').replace(/[&<>"']/g, (char) => {
                    return {
                        '&': '&amp;',
                        '<': '&lt;',
                        '>': '&gt;',
                        '"': '&quot;',
                        "'": '&#39;',
                    }[char];
                });
            },

            getSizeRiskMessageHtml(risk) {
                let message = risk.level === 'block'
                    ? this.t('dialog.sizeRiskBlockText', risk)
                    : this.t('dialog.sizeRiskText', risk);
                // No skip checkbox on hard blocks: that dialog has no
                // beforeClose reading it, and a hard block must not be skippable.
                let skipHtml = risk.level === 'block'
                    ? ''
                    : '<label class="size-risk-skip"><input id="size-risk-skip-checkbox" type="checkbox"> '
                        + this.escapeHtml(this.t('dialog.dontShowAgain')) + '</label>';
                return '<div class="size-risk-dialog-text">'
                    + '<p>' + this.escapeHtml(message) + '</p>'
                    + (risk.mobile ? '<p>' + this.escapeHtml(this.t('dialog.sizeRiskMobileHint')) + '</p>' : '')
                    + '<p>' + this.escapeHtml(this.t('dialog.sizeRiskSafeText')) + '</p>'
                    + skipHtml
                    + '</div>';
            },

            getProcessingRisk(w, h, scale) {
                let outputWidth = w * scale;
                let outputHeight = h * scale;
                let inputPixels = w * h;
                let outputPixels = outputWidth * outputHeight;
                let isMobileDevice = this.isMobileDevice();
                let gibibyte = 1024 * 1024 * 1024;
                let measuredBackendWorkingSet = (scale === 4 ? 1150 : (scale === 3 ? 1050 : 950)) * 1024 * 1024;
                let inputBytes = inputPixels * 4;
                let outputBytes = outputPixels * 4;
                let transparentAlphaAllowance = inputPixels;
                let estimatedBytes = measuredBackendWorkingSet
                    + inputBytes * 2
                    + outputBytes * 2
                    + transparentAlphaAllowance;
                let deviceMemoryGiB = this.getDeviceMemoryGiB(isMobileDevice);
                let practicalBudgetBytes = deviceMemoryGiB * gibibyte * (isMobileDevice ? 0.24 : 0.30);
                let warnBytes = Math.min(
                    (isMobileDevice ? 1200 : 1800) * 1024 * 1024,
                    Math.max(
                        (isMobileDevice ? 700 : 1100) * 1024 * 1024,
                        practicalBudgetBytes * 0.72
                    )
                );
                let blockBytes = Math.min(
                    (isMobileDevice ? 1600 : 2600) * 1024 * 1024,
                    Math.max(
                        (isMobileDevice ? 1100 : 1700) * 1024 * 1024,
                        practicalBudgetBytes
                    )
                );
                let level = 'ok';
                if (outputPixels > this.getCanvasPixelLimit() || inputPixels > this.getCanvasPixelLimit()) {
                    // Above the platform canvas limit the output canvas silently
                    // renders blank, so the export would be corrupt regardless of memory.
                    level = 'block';
                } else if (estimatedBytes >= blockBytes) {
                    level = 'block';
                } else if (estimatedBytes >= warnBytes) {
                    level = 'warn';
                } else if (isMobileDevice && scale >= 4 && deviceMemoryGiB <= 4) {
                    level = 'warn';
                }
                return {
                    level: level,
                    width: outputWidth,
                    height: outputHeight,
                    memory: Math.ceil(estimatedBytes / 1024 / 1024),
                    mobile: isMobileDevice,
                };
            },

            getRuntimeSettings(w, h, scale) {
                let hardwareConcurrency = Math.max(1, Math.floor(Number(navigator.hardwareConcurrency) || 4));
                let isMobileDevice = this.isMobileDevice();
                let deviceMemoryGiB = this.getDeviceMemoryGiB(isMobileDevice);
                let inputPixels = w * h;
                let workerFallback = this.shouldUseWorkerBackend(this.wasmBackend);
                let threadCap = 4;

                if (workerFallback) {
                    threadCap = 1;
                } else if (isMobileDevice) {
                    threadCap = deviceMemoryGiB <= 3 ? 2 : 4;
                } else {
                    threadCap = 4;
                }

                let threadCount = Math.max(1, Math.min(hardwareConcurrency, threadCap));
                let tileSize = 200;
                let memoryConstrained = deviceMemoryGiB <= 4 || (isMobileDevice && deviceMemoryGiB <= 6);
                let latencySensitive = workerFallback || isMobileDevice;
                if (memoryConstrained || (scale >= 4 && inputPixels >= 1280 * 720)) {
                    tileSize = 128;
                } else if (latencySensitive || deviceMemoryGiB <= 6) {
                    tileSize = 160;
                }
                if (this.safeProcessingMode) {
                    threadCount = Math.min(threadCount, isMobileDevice ? 2 : 4);
                    tileSize = Math.min(tileSize, 128);
                }

                return {
                    threadCount: threadCount,
                    tileSize: tileSize,
                    hardwareConcurrency: hardwareConcurrency,
                    deviceMemoryGiB: deviceMemoryGiB,
                };
            },

            async process(sourceCanvas, w, h) {
                let outputCanvas = document.getElementById('canvas-output');
                this.activeImageId += 1;
                let imageId = this.activeImageId;
                this.progressTip = this.t('progress.starting');
                this.processFailureDialogOpen = false;
                this.isProcessing = true;
                if (this.webReParallaxNodes) {
                    this.webReParallaxNodes.forEach((node) => {
                        node.style.transform = '';
                    });
                }
                this.startProcessWatchdog();
                this.isCancelling = false;
                this.isProcessDone = false;
                this.isResultRevealing = false;
                this.previewOverlapRate = 50;
                this.previewZoom = this.previewZoomMin;
                this.resetPreviewPan();
                this.progressRate = 0;
                this.procFinalCostSeconds = null;
                // init output params
                this.outputScale = this.isGpt ? 1 : this.scaleRadio;
                this.outputDenoise = this.denoiseRadio;
                this.outputModelType = this.modelTypeRadio;
                this.outputPreviewWidth = this.uploadPreviewWidth * this.outputScale;
                this.outputPreviewHeight = this.uploadPreviewHeight * this.outputScale;
                outputCanvas.width = 0;
                outputCanvas.height = 0;

                if (this.isGpt) {
                    try { gpt.run(this, sourceCanvas, w, h, imageId); }
                    catch (error) { this.handleProcessFailure(error); }
                    return;
                }

                try {
                    let modelFiles = this.getSelectedModelFiles(this.outputScale, this.outputDenoise, this.outputModelType);
                    let modelAssetPromise = this.preloadModelAssets(this.outputScale, this.outputDenoise, this.outputModelType);
                    if (!this.wasmUsesWorker) {
                        await this.ensureSelectedModelLoaded(this.outputScale, this.outputDenoise, this.outputModelType);
                        if (imageId !== this.activeImageId || !this.isProcessing) {
                            return;
                        }
                        this.progressTip = this.t('progress.starting');
                    }
                    let sourceContext = sourceCanvas.getContext('2d', {willReadFrequently: true});
                    let uploadImageData = sourceContext.getImageData(0, 0, w, h);
                    let inputByteLength = uploadImageData.data.length;
                    let outputByteLength = this.outputPreviewWidth * this.outputPreviewHeight * 4;
                let runtimeSettings = this.getRuntimeSettings(w, h, this.outputScale);
                this.processRuntimeSettings = runtimeSettings;
                    Logger.debug('runtime settings:', runtimeSettings);

                    if (this.wasmUsesWorker) {
                        let modelAssets = await modelAssetPromise;
                        let inputBuffer = uploadImageData.data.buffer;
                        let transferList = [inputBuffer];
                        let workerModelAssets = null;
                        if (modelAssets && modelAssets.paramBytes && modelAssets.binBytes) {
                            workerModelAssets = {
                                paramBuffer: modelAssets.paramBytes.buffer.slice(
                                    modelAssets.paramBytes.byteOffset,
                                    modelAssets.paramBytes.byteOffset + modelAssets.paramBytes.byteLength
                                ),
                                binBuffer: modelAssets.binBytes.buffer.slice(
                                    modelAssets.binBytes.byteOffset,
                                    modelAssets.binBytes.byteOffset + modelAssets.binBytes.byteLength
                                ),
                            };
                            transferList.push(workerModelAssets.paramBuffer, workerModelAssets.binBuffer);
                        }
                        this.wasmWorker.postMessage({
                            type: 'start',
                            backend: this.wasmBackend,
                            imageId: imageId,
                            modelFiles: modelFiles,
                            modelAssets: workerModelAssets,
                            inputBuffer: inputBuffer,
                            outputByteLength: outputByteLength,
                            outputWidth: this.outputPreviewWidth,
                            outputHeight: this.outputPreviewHeight,
                            width: w,
                            height: h,
                            scale: this.outputScale,
                            denoise: this.outputDenoise,
                            modelType: this.getModelTypeCode(this.outputModelType),
                            threadCount: runtimeSettings.threadCount,
                            tileSize: runtimeSettings.tileSize
                        }, transferList);
                        uploadImageData = null;
                        sourceCanvas.width = 0;
                        sourceCanvas.height = 0;
                        return;
                    }

                    srcInteractedData = _malloc(uploadImageData.data.length);
                    if (!srcInteractedData) {
                        throw new Error('malloc failed for input image');
                    }
                    HEAPU8.set(uploadImageData.data, srcInteractedData);
                    uploadImageData = null;
                    sourceCanvas.width = 0;
                    sourceCanvas.height = 0;

                    dstInteractedData = _malloc(outputByteLength);
                    if (!dstInteractedData) {
                        throw new Error('malloc failed for output image');
                    }

                    let retCode = _process_image(
                        imageId,
                        srcInteractedData,
                        inputByteLength,
                        dstInteractedData,
                        outputByteLength,
                        w,
                        h,
                        this.outputScale,
                        this.outputDenoise,
                        this.getModelTypeCode(this.outputModelType),
                        runtimeSettings.threadCount,
                        runtimeSettings.tileSize
                    );
                    if (retCode !== 0) {
                        this.handleBackendProcessError({
                            code: retCode,
                            message: 'process_image_rejected',
                        });
                    }
                } catch (error) {
                    this.finishModelLoading();
                    this.handleProcessFailure(error);
                }
            },

            getStageViewportSize() {
                this.stageLayoutTick;
                let stage = this.getStageSurfaceElement();
                let size = this.getAdaptiveStageSurfaceSize(this.getCurrentStageKind());
                let inset = this.isMobile ? 20 : ADAPTIVE_LAYOUT.stagePadding * 2;
                // Use the actual inner box (after margins, borders and flex shrink),
                // not the requested surface size; a minimum must never beat safety.
                return {
                    width: Math.max(1, Math.min(this.previewViewportWidth || size.width, stage ? stage.clientWidth : size.width) - inset),
                    height: Math.max(1, Math.min(this.previewViewportHeight || size.height, stage ? stage.clientHeight : size.height) - inset),
                };
            },

            scheduleStageLayoutSync() {
                if (this.stageLayoutFrame) {
                    cancelAnimationFrame(this.stageLayoutFrame);
                }
                this.stageLayoutFrame = requestAnimationFrame(() => {
                    this.stageLayoutFrame = null;
                    this.stageLayoutTick += 1;
                    this.syncPreviewViewport();
                });
            },

            getCurrentStageKind() {
                if (this.isProcessDone) {
                    return 'result';
                }
                if (this.uploadPreviewWidth !== 0) {
                    return 'input';
                }
                return 'empty';
            },

            getWorkspaceStyle() {
                let bounds = this.getAdaptiveStageBounds();
                let safeStyle = {'--workspace-max-height': bounds.maxPanelHeight + 'px'};
                if (this.isMobile) {
                    return {...safeStyle, height: bounds.maxPanelHeight + 'px'};
                }
                let controlWidth = ADAPTIVE_LAYOUT.controlPanelWidth;
                let gap = ADAPTIVE_LAYOUT.panelGap;
                let size = this.getAdaptiveStageSurfaceSize(this.getCurrentStageKind());
                return {
                    ...safeStyle,
                    '--workspace-center-y': bounds.workspaceCenterY + 'px',
                    width: Math.floor(controlWidth + gap + size.width) + 'px',
                    gridTemplateColumns: controlWidth + 'px minmax(0, ' + Math.floor(size.width) + 'px)',
                    gap: gap + 'px',
                };
            },

            getStageSurfaceClass(kind) {
                return 'stage-surface-adaptive stage-surface-' + kind;
            },

            getAdaptiveStageBounds() {
                this.stageLayoutTick;
                let layout = ADAPTIVE_LAYOUT;
                let appMain = this.getRefElement('appMain');
                let mainStyle = appMain ? getComputedStyle(appMain) : null;
                let paddingLeft = mainStyle ? parseFloat(mainStyle.paddingLeft) : 22;
                let paddingRight = mainStyle ? parseFloat(mainStyle.paddingRight) : 22;
                let paddingTop = mainStyle ? parseFloat(mainStyle.paddingTop) : 72;
                let paddingBottom = mainStyle ? parseFloat(mainStyle.paddingBottom) : 20;
                let header = this.$el.querySelector('.shell-head');
                let headerHeight = header ? header.offsetHeight + parseFloat(getComputedStyle(header).marginBottom) : 60;
                let footer = this.$el.querySelector('.app-footer');
                let footerHeight = footer ? footer.offsetHeight : 44;
                let fab = this.$el.querySelector('.mobile-settings-fab');
                let bottomReserve = footerHeight + 16;
                if (this.isMobile && fab) {
                    let fabStyle = getComputedStyle(fab);
                    bottomReserve = Math.max(bottomReserve, parseFloat(fabStyle.bottom) + fab.offsetHeight + 12);
                }
                let mainHeight = Math.min(this.windowHeight, appMain ? appMain.clientHeight : this.windowHeight);
                let workspaceTop = paddingTop + headerHeight;
                let workspaceBottom = mainHeight - Math.max(paddingBottom, bottomReserve);
                let maxPanelHeight = Math.max(1, workspaceBottom - workspaceTop);
                let workspaceWidth = Math.min(layout.maxWorkspaceWidth,
                    (appMain ? appMain.clientWidth : this.windowWidth) - paddingLeft - paddingRight);
                let toolbar = this.getRefElement('stageToolbar');
                let surface = this.getStageSurfaceElement();
                let surfaceStyle = surface ? getComputedStyle(surface) : null;
                let surfaceMargins = surfaceStyle
                    ? parseFloat(surfaceStyle.marginTop) + parseFloat(surfaceStyle.marginBottom) : 32;
                // Toolbar can wrap for a portrait image, long filename or translation.
                let chromeHeight = toolbar ? toolbar.offsetHeight + surfaceMargins + 5 : layout.stagePanelChromeHeight;
                let paddingSize = this.isMobile ? 20 : layout.stagePadding * 2;
                return {
                    maxPanelHeight,
                    workspaceCenterY: workspaceTop + maxPanelHeight / 2,
                    chromeHeight,
                    minSurfaceWidth: layout.minPreviewWidth + paddingSize,
                    minSurfaceHeight: layout.minPreviewHeight + paddingSize,
                    maxSurfaceWidth: Math.max(1, workspaceWidth - (this.isMobile ? 0 : layout.controlPanelWidth + layout.panelGap)),
                    maxSurfaceHeight: Math.max(1, maxPanelHeight - chromeHeight),
                };
            },

            getAdaptiveStageSurfaceSize(kind) {
                let layout = ADAPTIVE_LAYOUT;
                let bounds = this.getAdaptiveStageBounds();
                let paddingSize = this.isMobile ? 20 : layout.stagePadding * 2;
                if (kind === 'empty' || !this.uploadPreviewWidth || !this.uploadPreviewHeight) {
                    return {
                        width: Math.min(bounds.maxSurfaceWidth, (this.isMobile ? 320 : layout.emptyUploadWidth) + paddingSize),
                        height: Math.min(bounds.maxSurfaceHeight, (this.isMobile ? 240 : layout.emptyUploadHeight) + paddingSize),
                    };
                }

                let targetScale = this.outputScale || (this.isGpt ? 1 : this.scaleRadio);
                let imageWidth = this.outputPreviewWidth || this.uploadPreviewWidth * targetScale;
                let imageHeight = this.outputPreviewHeight || this.uploadPreviewHeight * targetScale;
                let naturalWidth = imageWidth + paddingSize;
                let naturalHeight = imageHeight + paddingSize;
                let scale = Math.min(
                    1,
                    bounds.maxSurfaceWidth / Math.max(1, naturalWidth),
                    bounds.maxSurfaceHeight / Math.max(1, naturalHeight)
                );
                let width = naturalWidth * scale;
                let height = naturalHeight * scale;
                // Floors are usability preferences, not permission to exceed the
                // available area. Keep the image aspect ratio in the inner preview.
                return {
                    width: Math.floor(Math.min(bounds.maxSurfaceWidth, Math.max(layout.minStageWidth, bounds.minSurfaceWidth, width))),
                    height: Math.floor(Math.min(bounds.maxSurfaceHeight, Math.max(bounds.minSurfaceHeight, height))),
                };
            },

            getStagePanelStyle() {
                this.stageLayoutTick;
                let size = this.getAdaptiveStageSurfaceSize(this.getCurrentStageKind());
                let bounds = this.getAdaptiveStageBounds();
                return {
                    width: Math.floor(size.width) + 'px',
                    height: Math.floor(Math.min(bounds.maxPanelHeight, size.height + bounds.chromeHeight)) + 'px',
                };
            },

            getStageSurfaceStyle(kind) {
                this.stageLayoutTick;
                let size = this.getAdaptiveStageSurfaceSize(kind);
                return {
                    width: Math.floor(size.width) + 'px',
                    height: Math.floor(size.height) + 'px',
                };
            },

            getInputPreviewSize() {
                if (!this.uploadPreviewWidth || !this.uploadPreviewHeight) {
                    return {width: 0, height: 0};
                }
                let stageSize = this.getStageViewportSize();
                let maxWidth = stageSize.width;
                let maxHeight = stageSize.height;
                let ratio = Math.min(maxWidth / this.uploadPreviewWidth, maxHeight / this.uploadPreviewHeight, 1);
                return {
                    width: Math.floor(this.uploadPreviewWidth * ratio),
                    height: Math.floor(this.uploadPreviewHeight * ratio),
                };
            },

            getPreviewSize() {
                let stageSize = this.getStageViewportSize();
                let maxWidth = stageSize.width;
                let maxHeight = this.getPreviewImageAreaHeight(stageSize.height);
                let originImgWidth = this.uploadPreviewWidth;
                let originImgHeight = this.uploadPreviewHeight;
                let outputImgWidth = this.outputPreviewWidth;
                let outputImgHeight = this.outputPreviewHeight;
                if (maxWidth < originImgWidth) {
                    originImgWidth = maxWidth;
                    originImgHeight = originImgWidth * (this.uploadPreviewHeight / this.uploadPreviewWidth);
                }
                if (maxWidth < outputImgWidth) {
                    outputImgWidth = maxWidth;
                    outputImgHeight = outputImgWidth * (this.outputPreviewHeight / this.outputPreviewWidth);
                }
                if (maxHeight < outputImgHeight) {
                    outputImgHeight = maxHeight;
                    outputImgWidth = outputImgHeight * (this.outputPreviewWidth / this.outputPreviewHeight);
                }
                return {
                    originImgWidth: originImgWidth,
                    originImgHeight: originImgHeight,
                    outputImgWidth: outputImgWidth,
                    outputImgHeight: outputImgHeight,
                };
            },

            getPreviewImageAreaHeight(viewportHeight) {
                return Math.max(1, viewportHeight || this.previewViewportHeight || 0);
            },

            getZoomedPreviewSize() {
                let baseSize = this.getPreviewSize();
                let zoomRatio = this.previewZoom / 100;
                return {
                    originImgWidth: Math.floor(baseSize.originImgWidth * zoomRatio),
                    originImgHeight: Math.floor(baseSize.originImgHeight * zoomRatio),
                    outputImgWidth: Math.floor(baseSize.outputImgWidth * zoomRatio),
                    outputImgHeight: Math.floor(baseSize.outputImgHeight * zoomRatio),
                };
            },

            // These run in style bindings every frame during split/pan drags;
            // prefer the cached previewViewportWidth (kept fresh by
            // syncPreviewViewport) over live clientWidth, which forces layout
            // mid-render.
            getViewportWidthCached() {
                if (this.previewViewportWidth) {
                    return this.previewViewportWidth;
                }
                let viewport = this.getPreviewViewportElement();
                return viewport ? viewport.clientWidth : 0;
            },

            getPreviewSplitViewportX() {
                let viewportWidth = this.getViewportWidthCached();
                return viewportWidth ? viewportWidth * this.previewOverlapRate / 100 : 0;
            },

            getPreviewSplitLocalX() {
                let viewportWidth = this.getViewportWidthCached();
                if (!viewportWidth) {
                    return 0;
                }
                let size = this.zoomedPreviewSize;
                let imageLeft = (viewportWidth - size.outputImgWidth) / 2 + this.previewPanX;
                let splitX = this.getPreviewSplitViewportX() - imageLeft;
                return Math.max(0, Math.min(size.outputImgWidth, splitX));
            },

            syncPreviewViewport() {
                this.$nextTick(() => {
                    let update = () => {
                        let viewport = this.getPreviewViewportElement() || this.getStageSurfaceElement();
                        if (viewport && viewport.clientWidth) {
                            this.previewViewportWidth = viewport.clientWidth;
                            this.previewViewportHeight = viewport.clientHeight;
                            this.clampPreviewPan();
                        }
                    };
                    update();
                    requestAnimationFrame(() => {
                        update();
                        requestAnimationFrame(update);
                    });
                });
            },

            zoomInPreview() {
                this.setPreviewZoom(this.previewZoom + this.previewZoomStep);
            },

            zoomOutPreview() {
                this.setPreviewZoom(this.previewZoom - this.previewZoomStep);
            },

            // focal (optional): viewport-relative point {x, y} measured from the
            // viewport center. The pan is adjusted so the image content under
            // that point stays put — cursor/pinch-anchored zoom. Without it,
            // zoom is about the center (toolbar buttons).
            setPreviewZoom(nextZoom, focal) {
                let previousZoom = this.previewZoom;
                // Keep fractional zoom internally — rounding here would swallow
                // small trackpad deltas (100 * 0.998 rounds straight back to
                // 100). The readout rounds at display time instead.
                this.previewZoom = Math.max(this.previewZoomMin, Math.min(this.previewZoomMax, nextZoom));
                if (focal && previousZoom > 0 && this.previewZoom !== previousZoom) {
                    let ratio = this.previewZoom / previousZoom;
                    // Keep the image point under the focal fixed:
                    // newPan = focal - (focal - oldPan) * ratio
                    this.previewPanX = focal.x - (focal.x - this.previewPanX) * ratio;
                    this.previewPanY = focal.y - (focal.y - this.previewPanY) * ratio;
                }
                this.$nextTick(() => {
                    this.clampPreviewPan();
                });
            },

            // Convert a client-coordinate event point into a viewport-center-
            // relative focal for setPreviewZoom.
            getZoomFocalPoint(clientX, clientY) {
                let viewport = this.getPreviewViewportElement();
                if (!viewport) {
                    return null;
                }
                let rect = viewport.getBoundingClientRect();
                return {
                    x: clientX - rect.left - rect.width / 2,
                    y: clientY - rect.top - rect.height / 2,
                };
            },

            // Image-viewer conventions: double-click toggles 100% <-> 200%
            // about the clicked point; the % readout resets zoom on click.
            onPreviewDoubleClick(event) {
                let target = this.previewZoom > this.previewZoomMin ? this.previewZoomMin : 200;
                this.setPreviewZoom(target, this.getZoomFocalPoint(event.clientX, event.clientY));
            },

            resetPreviewZoom() {
                this.setPreviewZoom(this.previewZoomMin);
                this.resetPreviewPan();
            },

            onPreviewWheel(event) {
                // Continuous, delta-proportional zoom. A trackpad emits dozens
                // of small deltaY events per swipe — fixed 25% steps made each
                // one jump a whole notch, slamming to min/max instantly.
                // Mouse wheels emit large deltas (~100/notch) and land near the
                // old step size; deltaMode 1 (lines) is normalized to pixels.
                let deltaY = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
                let factor = Math.exp(-deltaY * 0.0022);
                this.setPreviewZoom(
                    this.previewZoom * factor,
                    this.getZoomFocalPoint(event.clientX, event.clientY)
                );
            },

            resetPreviewPan() {
                this.previewDragging = false;
                this.previewPanX = 0;
                this.previewPanY = 0;
            },

            getPreviewPanBounds() {
                // Cached viewport dims + cached zoomed size: this runs on every
                // pointermove during a pan drag.
                let viewportWidth = this.getViewportWidthCached();
                let viewportHeight = this.previewViewportHeight;
                if (!viewportHeight) {
                    let viewport = this.getPreviewViewportElement();
                    viewportHeight = viewport ? viewport.clientHeight : 0;
                }
                if (!viewportWidth || !viewportHeight) {
                    return {maxX: 0, maxY: 0};
                }
                let size = this.zoomedPreviewSize;
                let imageAreaHeight = this.getPreviewImageAreaHeight(viewportHeight);
                return {
                    maxX: Math.max(0, (size.outputImgWidth - viewportWidth) / 2),
                    maxY: Math.max(0, (size.outputImgHeight - imageAreaHeight) / 2),
                };
            },

            clampPreviewPan() {
                let bounds = this.getPreviewPanBounds();
                this.previewPanX = Math.max(-bounds.maxX, Math.min(bounds.maxX, this.previewPanX));
                this.previewPanY = Math.max(-bounds.maxY, Math.min(bounds.maxY, this.previewPanY));
            },

            getPanEventPoint(event) {
                let touch = event.touches && event.touches.length > 0 ? event.touches[0] : null;
                let changedTouch = event.changedTouches && event.changedTouches.length > 0 ? event.changedTouches[0] : null;
                let point = touch || changedTouch || event;
                return {
                    x: point.clientX,
                    y: point.clientY,
                };
            },

            onSplitHandleKeydown(event) {
                let step = event.shiftKey ? 10 : 2;
                let delta = 0;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                    delta = -step;
                } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                    delta = step;
                } else if (event.key === 'Home') {
                    this.previewOverlapRate = 0;
                    event.preventDefault();
                    return;
                } else if (event.key === 'End') {
                    this.previewOverlapRate = 100;
                    event.preventDefault();
                    return;
                } else {
                    return;
                }
                this.previewOverlapRate = Math.max(0, Math.min(100, this.previewOverlapRate + delta));
                event.preventDefault();
            },

            startSplitDrag(event) {
                let point = this.getPanEventPoint(event);
                this.splitDragging = true;
                this.splitDragStartX = point.x;
                this.splitDragStartRate = this.previewOverlapRate;

                const moveHandler = (e) => {
                    if (!this.splitDragging) return;
                    let p = this.getPanEventPoint(e);
                    let deltaX = p.x - this.splitDragStartX;
                    let viewport = this.getPreviewViewportElement();
                    let viewportWidth = this.previewViewportWidth || (viewport ? viewport.clientWidth : 0);
                    if (!viewportWidth) return;
                    let deltaRate = (deltaX / viewportWidth) * 100;
                    let nextRate = Math.max(0, Math.min(100, this.splitDragStartRate + deltaRate));
                    this.previewOverlapRate = nextRate;
                };

                const endHandler = () => {
                    this.splitDragging = false;
                    document.removeEventListener('mousemove', moveHandler);
                    document.removeEventListener('mouseup', endHandler);
                    document.removeEventListener('touchmove', moveHandler);
                    document.removeEventListener('touchend', endHandler);
                    document.removeEventListener('touchcancel', endHandler);
                };

                document.addEventListener('mousemove', moveHandler);
                document.addEventListener('mouseup', endHandler);
                document.addEventListener('touchmove', moveHandler, { passive: false });
                document.addEventListener('touchend', endHandler);
                document.addEventListener('touchcancel', endHandler);
            },

            getTouchPinchDistance(event) {
                let a = event.touches[0];
                let b = event.touches[1];
                return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            },

            startPreviewPan(event) {
                if (event.target.closest && event.target.closest('.el-slider')) {
                    return;
                }
                if (event.touches && event.touches.length === 2) {
                    // Two fingers: start a pinch zoom (works even at 100%).
                    this.previewDragging = false;
                    this.previewPinchStartDistance = this.getTouchPinchDistance(event);
                    this.previewPinchStartZoom = this.previewZoom;
                    event.preventDefault();
                    return;
                }
                if (this.previewZoom <= this.previewZoomMin) {
                    return;
                }
                let bounds = this.getPreviewPanBounds();
                if (bounds.maxX === 0 && bounds.maxY === 0) {
                    return;
                }
                let point = this.getPanEventPoint(event);
                // Grabbing mid-glide interrupts it — drag starts from the
                // current on-screen position, Apple-style interruptibility.
                this.cancelPanGlide();
                this.panVelocitySamples = [];
                this.previewDragging = true;
                this.previewDragStartX = point.x;
                this.previewDragStartY = point.y;
                this.previewDragOriginX = this.previewPanX;
                this.previewDragOriginY = this.previewPanY;
                event.preventDefault();
                if (!event.touches) {
                    // Mouse drags follow the pointer document-wide: with
                    // element-bound listeners, the drag died the instant the
                    // cursor left the viewport (mouseleave) — easy to hit on a
                    // fast pan. Touch events keep firing on the start element,
                    // so the template's touch bindings stay as they are.
                    const moveHandler = (e) => this.movePreviewPan(e);
                    const upHandler = () => {
                        this.endPreviewPan();
                        document.removeEventListener('mousemove', moveHandler);
                        document.removeEventListener('mouseup', upHandler);
                    };
                    document.addEventListener('mousemove', moveHandler);
                    document.addEventListener('mouseup', upHandler);
                }
            },

            movePreviewPan(event) {
                if (event.touches && event.touches.length === 2 && this.previewPinchStartDistance) {
                    let ratio = this.getTouchPinchDistance(event) / this.previewPinchStartDistance;
                    let midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
                    let midY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
                    this.setPreviewZoom(
                        Math.round(this.previewPinchStartZoom * ratio),
                        this.getZoomFocalPoint(midX, midY)
                    );
                    event.preventDefault();
                    return;
                }
                if (!this.previewDragging) {
                    return;
                }
                let point = this.getPanEventPoint(event);
                this.previewPanX = this.previewDragOriginX + point.x - this.previewDragStartX;
                this.previewPanY = this.previewDragOriginY + point.y - this.previewDragStartY;
                this.clampPreviewPan();
                // Short position history for release velocity (momentum glide).
                let now = performance.now();
                this.panVelocitySamples.push({x: point.x, y: point.y, t: now});
                if (this.panVelocitySamples.length > 5) {
                    this.panVelocitySamples.shift();
                }
                event.preventDefault();
            },

            endPreviewPan(event) {
                if (event && event.touches && event.touches.length >= 2) {
                    return;
                }
                let wasDragging = this.previewDragging;
                this.previewDragging = false;
                this.previewPinchStartDistance = 0;
                if (wasDragging) {
                    this.startPanGlide();
                }
                this.panVelocitySamples = [];
            },

            // Momentum: project the release velocity with exponential decay
            // (Apple's deceleration model) and glide there, clamping at bounds.
            startPanGlide() {
                let samples = this.panVelocitySamples;
                if (!samples || samples.length < 2) {
                    return;
                }
                let last = samples[samples.length - 1];
                let first = samples[0];
                let dt = last.t - first.t;
                // Stale samples mean the pointer paused before release — no fling.
                if (dt <= 0 || (performance.now() - last.t) > 80) {
                    return;
                }
                let vx = (last.x - first.x) / dt; // px per ms
                let vy = (last.y - first.y) / dt;
                if (Math.hypot(vx, vy) < 0.25) {
                    return;
                }
                const DECAY = 0.95; // per frame @60fps
                let step = () => {
                    if (this.previewDragging || !this.isProcessDone) {
                        this.panGlideFrame = null;
                        return;
                    }
                    this.previewPanX += vx * 16;
                    this.previewPanY += vy * 16;
                    let bounds = this.getPreviewPanBounds();
                    // Kill the axis velocity on impact with a bound.
                    if (this.previewPanX <= -bounds.maxX || this.previewPanX >= bounds.maxX) {
                        vx = 0;
                    }
                    if (this.previewPanY <= -bounds.maxY || this.previewPanY >= bounds.maxY) {
                        vy = 0;
                    }
                    this.clampPreviewPan();
                    vx *= DECAY;
                    vy *= DECAY;
                    if (Math.hypot(vx, vy) > 0.02) {
                        this.panGlideFrame = requestAnimationFrame(step);
                    } else {
                        this.panGlideFrame = null;
                    }
                };
                this.cancelPanGlide();
                this.panGlideFrame = requestAnimationFrame(step);
            },

            cancelPanGlide() {
                if (this.panGlideFrame) {
                    cancelAnimationFrame(this.panGlideFrame);
                    this.panGlideFrame = null;
                }
            },

            versionedUrl(path) {
                return path + '?v=' + encodeURIComponent(this.appVersion);
            },

            hasStableWasmProgress() {
                return this.wasmLoadingProgress >= 10;
            },

            getWasmLoadingText() {
                if (!this.hasStableWasmProgress()) {
                    return this.t('stage.preparingBackend');
                }
                return this.t('stage.loadingAssetsProgress', {percent: this.wasmLoadingProgress});
            },

            ensureWasmLoaded() {
                if (this.isGpt) {
                    this.wasmUsesWorker = true;
                    return Promise.resolve();
                }
                if (this.wasmModuleLoaded) {
                    return Promise.resolve();
                }
                if (this.wasmLoadPromise) {
                    return this.wasmLoadPromise;
                }

                this.wasmLoading = true;
                this.wasmLoadingProgress = 1;
                this.wasmLoadPromise = this.checkWasmSupportAndLoad()
                    .then(() => {
                        this.wasmModuleLoaded = true;
                        this.wasmLoadingProgress = 100;
                        this.preloadSelectedModelAssets();
                    })
                    .catch((error) => {
                        this.wasmLoadPromise = null;
                        throw error;
                    })
                    .then((result) => {
                        this.wasmLoading = false;
                        return result;
                    }, (error) => {
                        this.wasmLoading = false;
                        this.wasmLoadingProgress = 0;
                        throw error;
                    });
                return this.wasmLoadPromise;
            },

            // Idle-time cache warmer: fetch the likely backend's .wasm/.js and
            // the selected model into the HTTP cache without initializing
            // anything. ensureWasmLoaded() later hits warm cache entries.
            prefetchBackendAssets() {
                if (this.isGpt) return;
                Promise.all([
                    wasmFeatureDetect.simd().catch(() => false),
                    wasmFeatureDetect.threads().catch(() => false),
                ]).then(([hasSIMD, hasThreads]) => {
                    let canUseThreads = this.canUseThreadedBackend(hasSIMD, hasThreads);
                    let backend = this.getBackendCandidates(hasSIMD, canUseThreads)[0];
                    let quiet = () => null;
                    fetch(this.versionedUrl('realcugan-ncnn-webassembly-' + backend + '.wasm'), {cache: 'force-cache'}).catch(quiet);
                    fetch(this.versionedUrl('realcugan-ncnn-webassembly-' + backend + '.js'), {cache: 'force-cache'}).catch(quiet);
                    this.preloadSelectedModelAssets();
                }).catch(() => {});
            },

            checkWasmSupportAndLoad() {
                return Promise.all([
                    wasmFeatureDetect.simd().catch(() => false),
                    wasmFeatureDetect.threads().catch(() => false),
                ]).then(([hasSIMD, hasThreads]) => {
                    let canUseThreads = this.canUseThreadedBackend(hasSIMD, hasThreads);
                    let backends = this.getBackendCandidates(hasSIMD, canUseThreads);
                    return this.loadWasmBackend(backends);
                });
            },

            canUseThreadedBackend(hasSIMD, hasThreads) {
                return !!(
                    hasSIMD &&
                    hasThreads &&
                    typeof SharedArrayBuffer !== 'undefined' &&
                    window.crossOriginIsolated === true
                );
            },

            getBackendCandidates(hasSIMD, canUseThreads) {
                if (this.backendMode === 'basic') {
                    return ['basic'];
                }
                if (this.backendMode === 'simd') {
                    return hasSIMD ? ['simd', 'basic'] : ['basic'];
                }
                if (this.backendMode === 'simd-threads') {
                    return canUseThreads ? ['simd-threads', 'simd', 'basic'] : (hasSIMD ? ['simd', 'basic'] : ['basic']);
                }

                if (canUseThreads) {
                    return ['simd-threads', 'simd', 'basic'];
                }
                if (hasSIMD) {
                    return ['simd', 'basic'];
                }
                return ['basic'];
            },

            // Fall through to the next backend candidate, or surface the error
            // once every candidate has failed.
            handleBackendLoadFailure(backends, backend, error) {
                Logger.error(error);
                if (backends.length > 1) {
                    return this.loadWasmBackend(backends.slice(1));
                }
                this.$alert(this.t('dialog.resourceErrorText', {backend: backend}), this.t('dialog.resourceErrorTitle'), {
                    confirmButtonText: this.t('dialog.ok'),
                });
                throw error;
            },

            loadWasmBackend(backends) {
                let backend = backends[0];
                this.wasmBackend = backend;
                Logger.info('selected wasm backend:', backend);
                this.wasmLoadingProgress = Math.max(this.wasmLoadingProgress, 3);
                if (this.shouldUseWorkerBackend(backend)) {
                    return this.loadWorkerBackend(backend)
                        .catch((error) => this.handleBackendLoadFailure(backends, backend, error));
                }

                this.wasmUsesWorker = false;
                return fetch(this.versionedUrl("realcugan-ncnn-webassembly-" + backend + ".wasm"))
                    .then((response) => {
                        if (!response.ok) {
                            throw new Error('WASM resource not found: ' + backend);
                        }
                        // Stream the multi-MB download so the progress bar moves
                        // (5 → 60%) instead of sitting still until it completes.
                        let totalBytes = Number(response.headers.get('content-length')) || 0;
                        if (!response.body || !totalBytes) {
                            return response.arrayBuffer();
                        }
                        let reader = response.body.getReader();
                        let chunks = [];
                        let receivedBytes = 0;
                        let pump = () => reader.read().then(({done, value}) => {
                            if (done) {
                                let buffer = new Uint8Array(receivedBytes);
                                let offset = 0;
                                chunks.forEach((chunk) => {
                                    buffer.set(chunk, offset);
                                    offset += chunk.length;
                                });
                                return buffer.buffer;
                            }
                            chunks.push(value);
                            receivedBytes += value.length;
                            this.wasmLoadingProgress = Math.max(
                                this.wasmLoadingProgress,
                                5 + Math.round((receivedBytes / totalBytes) * 55)
                            );
                            return pump();
                        });
                        return pump();
                    })
                    .then((buffer) => {
                        return new Promise((resolve, reject) => {
                            let settled = false;
                            let timeoutId = null;
                            let settle = (callback, value) => {
                                if (settled) {
                                    return;
                                }
                                settled = true;
                                if (timeoutId) {
                                    clearTimeout(timeoutId);
                                }
                                callback(value);
                            };
                            Module.wasmBinary = buffer;
                            Module.locateFile = (path, prefix) => {
                                if (path.indexOf('.worker.js') !== -1) {
                                    return this.versionedUrl(path);
                                }
                                return prefix + path;
                            };
                            Module.onRuntimeInitialized = () => {
                                Logger.info('wasm module loaded:', backend);
                                this.wasmLoadingProgress = 100;
                                settle(resolve);
                            }

                            let script = document.createElement('script');
                            script.src = this.versionedUrl("realcugan-ncnn-webassembly-" + backend + ".js");
                            script.onload = () => {
                                Logger.debug('Emscripten loaded:', backend);
                                this.wasmLoadingProgress = Math.max(this.wasmLoadingProgress, 5);
                            }
                            script.onerror = () => {
                                settle(reject, new Error('JS resource not found: ' + backend));
                            }
                            document.body.appendChild(script);
                            timeoutId = setTimeout(() => {
                                settle(reject, new Error('backend runtime load timed out: ' + backend));
                            }, 30000);
                        });
                    })
                    .catch((error) => this.handleBackendLoadFailure(backends, backend, error));
            },

            shouldUseWorkerBackend(backend) {
                return backend === 'basic' || backend === 'simd';
            },

            loadWorkerBackend(backend) {
                this.wasmUsesWorker = true;
                if (!this.wasmWorker) {
                    this.wasmWorker = new Worker(this.versionedUrl('wasmFallbackWorker.js'));
                    this.wasmWorker.onmessage = (event) => this.handleWorkerMessage(event.data || {});
                    this.wasmWorker.onerror = (event) => {
                        this.handleProcessFailure(event.message || 'fallback worker failed');
                    };
                }

                return new Promise((resolve, reject) => {
                    let settled = false;
                    let timeoutId = null;
                    let cleanup = () => {
                        this.wasmWorker.removeEventListener('message', onMessage);
                        this.wasmWorker.removeEventListener('error', onError);
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                        }
                    };
                    let fail = (error) => {
                        settled = true;
                        cleanup();
                        if (this.wasmWorker) {
                            this.wasmWorker.terminate();
                            this.wasmWorker = null;
                        }
                        reject(error);
                    };
                    let onMessage = (event) => {
                        let message = event.data || {};
                        if (message.backend && message.backend !== backend) {
                            return;
                        }
                        if (message.type === 'loading') {
                            this.wasmLoadingProgress = Math.max(this.wasmLoadingProgress, message.progress || 5);
                        } else if (message.type === 'ready') {
                            settled = true;
                            cleanup();
                            this.wasmLoadingProgress = 100;
                            resolve();
                        } else if (message.type === 'error') {
                            fail(new Error(message.detail || message.message || 'fallback worker load failed'));
                        }
                    };
                    let onError = (event) => {
                        if (!settled) {
                            fail(new Error(event.message || 'fallback worker script failed: ' + backend));
                        }
                    };
                    this.wasmWorker.addEventListener('message', onMessage);
                    this.wasmWorker.addEventListener('error', onError);
                    this.wasmWorker.postMessage({
                        type: 'load',
                        backend: backend,
                        appVersion: this.appVersion
                    });
                    timeoutId = setTimeout(() => {
                        if (!settled) {
                            fail(new Error('fallback worker load timed out: ' + backend));
                        }
                    }, 30000);
                });
            },

            handleWorkerMessage(message) {
                // Any worker traffic counts as liveness for the stall watchdog
                // (model downloads legitimately take a while before tile progress).
                this.feedProcessWatchdog();
                if (message.type === 'loading') {
                    this.wasmLoadingProgress = Math.max(this.wasmLoadingProgress, message.progress || 5);
                    return;
                }
                if (message.type === 'model-loading') {
                    let progress = message.progress || 0;
                    if (progress >= 100) {
                        this.finishModelLoading();
                        this.progressTip = this.t('progress.starting');
                    } else {
                        this.startModelLoading({label: message.model || ''}, progress, message.file || '');
                    }
                    return;
                }
                if (message.type === 'stderr') {
                    Logger.error('[worker]', message.text);
                    return;
                }
                if (message.type === 'ready') {
                    return;
                }
                if (message.type === 'cancel-requested') {
                    return;
                }
                if (message.type === 'error' && message.imageId === undefined && !this.isProcessing) {
                    return;
                }
                if (message.imageId !== undefined && message.imageId !== this.activeImageId) {
                    return;
                }
                if (message.type === 'progress') {
                    this.onProcessProgressChange(message.totalCost, message.tileCost, message.progressRate, message.remainingTime);
                } else if (message.type === 'complete') {
                    this.onProcessEnd(message.cost, message.outputBuffer, message.width, message.height);
                } else if (message.type === 'cancelled') {
                    this.onProcessCancelled();
                } else if (message.type === 'error') {
                    this.handleBackendProcessError(message);
                }
            },

            onProcessEnd(cost, outputBuffer, outputWidth, outputHeight) {
                this.isCancelling = false;
                if (!this.wasmUsesWorker && !dstInteractedData) {
                    this.handleProcessFailure('missing output buffer');
                    return;
                }
                let canvasOutput = document.getElementById('canvas-output');
                canvasOutput.width = outputWidth || this.outputPreviewWidth;
                canvasOutput.height = outputHeight || this.outputPreviewHeight;
                let ctxOutput = canvasOutput.getContext('2d');
                let outputByteLength = canvasOutput.width * canvasOutput.height * 4;
                let result = outputBuffer
                    ? new Uint8ClampedArray(outputBuffer)
                    : new Uint8ClampedArray(HEAPU8.buffer, dstInteractedData, outputByteLength);
                let imageDataOutput;
                try {
                    imageDataOutput = new ImageData(result, canvasOutput.width, canvasOutput.height);
                } catch (error) {
                    // Some browsers reject ImageData views backed by SharedArrayBuffer.
                    imageDataOutput = new ImageData(
                        new Uint8ClampedArray(result),
                        canvasOutput.width,
                        canvasOutput.height
                    );
                }
                ctxOutput.putImageData(imageDataOutput, 0, 0);
                Logger.debug('output size:', outputByteLength);
                if (this.outputObjectUrl && !this.isBatchManagedObjectUrl(this.outputObjectUrl)) {
                    URL.revokeObjectURL(this.outputObjectUrl);
                }
                this.outputObjectUrl = '';
                const completedImageId = this.activeImageId;
                canvasOutput.toBlob((blob) => {
                    if (this.isGpt && (completedImageId !== this.activeImageId || !this.isProcessing)) return;
                    if (blob) {
                        this.outputObjectUrl = URL.createObjectURL(blob);
                        this.outputImgSrc = this.outputObjectUrl;
                        if (this.isBatchActive && this.activeBatchItemId) {
                            // Share the URL with the batch item: clearUploadPreviewUrl /
                            // onProcessEnd both check isBatchManagedObjectUrl before
                            // revoking, so a single URL per blob is safe.
                            this.rememberBatchResult(this.outputObjectUrl, canvasOutput.width, canvasOutput.height);
                        }
                    } else {
                        this.handleProcessFailure('failed to encode output image');
                        return;
                    }
                    let costNum = Math.round(cost / 1000);
                    if (cost < 1000) {
                        costNum = (cost / 1000).toFixed(2);
                    }
                    this.procFinalCostSeconds = costNum;
                    this.progressTip = this.t('progress.done', {seconds: costNum});
                    this.isProcessing = false;
                    this.isProcessDone = true;
                    this.safeProcessingMode = false;
                    this.scheduleStageLayoutSync();
                    this.beginResultReveal();
                    this.syncPreviewViewport();
                    this.scrollStageIntoView();
                    this.resolveCurrentProcess({
                        filename: this.getOutputFilename(),
                        objectUrl: this.outputObjectUrl,
                        width: canvasOutput.width,
                        height: canvasOutput.height,
                    });
                    this.$nextTick(() => {
                        this.$notify({
                            title: this.t('notify.success'),
                            message: this.progressTip,
                            type: 'success'
                        });
                    });
                }, 'image/png');

                this.releaseWasmBuffers();
            },

            releaseWasmBuffers() {
                if (this.wasmUsesWorker) {
                    srcInteractedData = null;
                    dstInteractedData = null;
                    return;
                }
                if (srcInteractedData) {
                    _free(srcInteractedData);
                    srcInteractedData = null;
                }
                if (dstInteractedData) {
                    _free(dstInteractedData);
                    dstInteractedData = null;
                }
            },

            clearOutputPreviewUrl() {
                if (this.outputObjectUrl && !this.isBatchManagedObjectUrl(this.outputObjectUrl)) {
                    URL.revokeObjectURL(this.outputObjectUrl);
                }
                this.outputObjectUrl = '';
                this.outputImgSrc = '';
            },

            clearUploadPreviewUrl() {
                if (this.uploadObjectUrl) {
                    if (!this.isBatchManagedObjectUrl(this.uploadObjectUrl)) {
                        URL.revokeObjectURL(this.uploadObjectUrl);
                    }
                    this.uploadObjectUrl = '';
                }
                this.uploadImgSrc = '';
            },

            isBatchManagedObjectUrl(objectUrl) {
                if (!objectUrl || !this.batchItems || !this.batchItems.length) {
                    return false;
                }
                return this.batchItems.some((item) => {
                    return item.previewObjectUrl === objectUrl || item.objectUrl === objectUrl;
                });
            },

            beginResultReveal() {
                if (this.resultRevealTimer) {
                    clearTimeout(this.resultRevealTimer);
                    this.resultRevealTimer = null;
                }
                this.isResultRevealing = true;
                this.startRevealWipeSweep();
                this.resultRevealTimer = setTimeout(() => {
                    this.isResultRevealing = false;
                    this.resultRevealTimer = null;
                }, 1900);
            },

            // The reveal moment: sweep the compare split 0 -> 100 -> 50 so the
            // first thing the user sees is the result literally wiping across
            // the original — the product's core value made visible. Respects
            // reduced motion, and any user drag on the handle cancels it.
            startRevealWipeSweep() {
                this.cancelRevealWipeSweep();
                if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    return;
                }
                let start = null;
                const DURATION = 1500;
                let step = (now) => {
                    if (this.splitDragging || !this.isProcessDone) {
                        // User grabbed the handle (or state changed) — hand over control.
                        this.revealWipeFrame = null;
                        return;
                    }
                    if (start === null) {
                        start = now;
                    }
                    let t = Math.min(1, (now - start) / DURATION);
                    // Ease-in-out; phase 1 (0-0.62): 0 -> 100, phase 2: 100 -> 50.
                    let eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                    this.previewOverlapRate = eased < 0.62
                        ? (eased / 0.62) * 100
                        : 100 - ((eased - 0.62) / 0.38) * 50;
                    if (t < 1) {
                        this.revealWipeFrame = requestAnimationFrame(step);
                    } else {
                        this.previewOverlapRate = 50;
                        this.revealWipeFrame = null;
                    }
                };
                this.previewOverlapRate = 0;
                this.revealWipeFrame = requestAnimationFrame(step);
            },

            cancelRevealWipeSweep() {
                if (this.revealWipeFrame) {
                    cancelAnimationFrame(this.revealWipeFrame);
                    this.revealWipeFrame = null;
                }
            },

            clearResultReveal() {
                if (this.resultRevealTimer) {
                    clearTimeout(this.resultRevealTimer);
                    this.resultRevealTimer = null;
                }
                this.cancelRevealWipeSweep();
                this.isResultRevealing = false;
            },

            restoreAfterProcessFailure() {
                this.clearResultReveal();
                this.releaseWasmBuffers();
                this.isProcessing = false;
                this.isCancelling = false;
                this.isProcessDone = false;
                this.progressRate = 0;
                this.procFinalCostSeconds = null;
                this.progressTip = '';
                this.safeProcessingMode = false;
                this.finishModelLoading();
                this.clearOutputPreviewUrl();
                this.outputPreviewWidth = 0;
                this.outputPreviewHeight = 0;
                let outputCanvas = document.getElementById('canvas-output');
                if (outputCanvas) {
                    outputCanvas.width = 0;
                    outputCanvas.height = 0;
                }
            },

            // Single mapping from a process error (numeric backend code and/or
            // raw text) to the actionable dialog message key. Code checks win
            // when a code is present; text signatures cover the JS-side errors.
            mapProcessErrorKey(code, lowerText) {
                if (!isNaN(code)) {
                    if (code === -1) {
                        return 'processErrorConflict';
                    }
                    if (code === -7) {
                        return 'processErrorMemory';
                    }
                    if (code === -8 || code === -9) {
                        return 'processErrorModel';
                    }
                    if (code >= -6 && code <= -2) {
                        return 'processErrorInput';
                    }
                }
                if (lowerText.includes('memory access out of bounds') || lowerText.includes('out of memory') || lowerText.includes('malloc failed')) {
                    return 'processErrorMemory';
                }
                if (lowerText.includes('parse magic failed') || lowerText.includes('load_param') || lowerText.includes('.param') || lowerText.includes('.bin') || lowerText.includes('model_')) {
                    return 'processErrorModel';
                }
                if (lowerText.includes('not found') || lowerText.includes('.wasm') || lowerText.includes('worker')) {
                    return 'processErrorAsset';
                }
                if (lowerText.includes('process_image returned')) {
                    return 'processErrorConflict';
                }
                return 'processErrorGeneric';
            },

            getActionableProcessError(error) {
                let raw = error && error.message ? error.message : (error + '');
                return {
                    raw: raw,
                    message: this.t('dialog.' + this.mapProcessErrorKey(NaN, raw.toLowerCase())),
                };
            },

            handleBackendProcessError(error) {
                let code = Number(error && error.code);
                let rawMessage = error && error.message ? error.message : '';
                let message = this.t('dialog.' + this.mapProcessErrorKey(code, rawMessage.toLowerCase()));
                let detail = 'backend code ' + code;
                if (error && error.message) {
                    detail += ': ' + error.message;
                }
                if (error && error.detail && error.detail !== error.message) {
                    detail += '\n' + error.detail;
                }
                this.handleProcessFailure({
                    message: message + '\n\n' + detail,
                    isMappedBackendError: true,
                });
            },

            handleProcessFailure(error) {
                let mapped = error && error.isMappedBackendError
                    ? {message: error.message, raw: ''}
                    : this.getActionableProcessError(error);
                this.restoreAfterProcessFailure();
                this.rejectCurrentProcess(error);
                if (this.isBatchProcessing) {
                    // No modal mid-batch: the item's red error tag and the final
                    // summary already tell the story; a dialog per failed image
                    // would make the user babysit the queue.
                    return;
                }
                if (this.processFailureDialogOpen) {
                    return;
                }
                this.processFailureDialogOpen = true;
                let detail = mapped.raw ? mapped.message + '\n\n' + mapped.raw : mapped.message;
                this.$alert(this.t('dialog.processErrorText', {message: detail}), this.t('dialog.processErrorTitle'), {
                    confirmButtonText: this.t('dialog.ok'),
                    callback: () => {
                        this.processFailureDialogOpen = false;
                    },
                });
            },

            onProcessProgressChange(totalCost, tileCost, progressRate, remainingTime) {
                this.feedProcessWatchdog();
                if (this.isCancelling) {
                    return;
                }
                this.progressTip = this.t('progress.processing');
                this.progressRate = Math.ceil(progressRate * 100);
                this.procFinalCostSeconds = null;
            },

            // ---- stall watchdog -------------------------------------------
            // If the backend hangs (worker deadlock, wasm stall) isProcessing
            // stays true forever with no signal. Track the last progress event
            // and surface a one-shot warning so the user knows to cancel.
            feedProcessWatchdog() {
                this.processWatchdogLastActivity = Date.now();
            },

            startProcessWatchdog() {
                this.stopProcessWatchdog();
                this.feedProcessWatchdog();
                this.processWatchdogNotified = false;
                this.processWatchdogInterval = setInterval(() => {
                    if (!this.isProcessing) {
                        this.stopProcessWatchdog();
                        return;
                    }
                    let stalledSeconds = Math.round((Date.now() - this.processWatchdogLastActivity) / 1000);
                    if (stalledSeconds >= 90 && !this.processWatchdogNotified) {
                        this.processWatchdogNotified = true;
                        this.$notify({
                            title: this.t('dialog.processErrorTitle'),
                            message: this.t('progress.stalled', {seconds: stalledSeconds}),
                            type: 'warning',
                            duration: 0,
                        });
                    }
                }, 10000);
            },

            stopProcessWatchdog() {
                if (this.processWatchdogInterval) {
                    clearInterval(this.processWatchdogInterval);
                    this.processWatchdogInterval = null;
                }
            },

            saveOutput() {
                if (!this.outputObjectUrl) {
                    this.handleProcessFailure('missing output download blob');
                    return;
                }
                let filename = this.getOutputFilename();
                this.triggerDownload(this.outputObjectUrl, filename);
                this.$notify({
                    title: this.t('notify.saved'),
                    message: filename,
                    type: 'success'
                });
            },

            stopProcess() {
                if (!this.isProcessing || this.isCancelling) {
                    return;
                }
                this.isCancelling = true;
                if (this.isBatchProcessing) {
                    this.batchCancelRequested = true;
                }
                this.progressTip = this.t('progress.cancelling');
                if (this.isGpt) {
                    gpt.cancel(this);
                    return;
                }
                if (this.wasmUsesWorker) {
                    if (this.wasmWorker) {
                        this.wasmWorker.postMessage({
                            type: 'cancel',
                            imageId: this.activeImageId
                        });
                    }
                    return;
                }
                if (typeof _cancel_process !== 'function') {
                    this.$alert(this.t('dialog.processErrorAsset'), this.t('dialog.processErrorTitle'), {
                        confirmButtonText: this.t('dialog.ok'),
                    });
                    return;
                }
                _cancel_process();
            },

            onProcessCancelled() {
                if (this.isGpt) {
                    this.rejectCurrentProcess(new Error('processing cancelled'));
                    this.restoreAfterProcessFailure();
                    return;
                }
                this.rejectCurrentProcess(new Error('processing cancelled'));
                this.resetWorkspace({keepBatch: this.isBatchActive});
            },

            resetWorkspace(options) {
                options = options || {};
                this.clearResultReveal();
                this.releaseWasmBuffers();
                this.clearUploadPreviewUrl();
                this.uploadPreviewWidth = 0;
                this.uploadPreviewHeight = 0;
                this.uploadPreviewName = '';
                this.clearOutputPreviewUrl();
                this.outputPreviewWidth = 0;
                this.outputPreviewHeight = 0;
                this.outputScale = 0;
                this.outputDenoise = 0;
                this.outputModelType = 'se';
                this.isProcessing = false;
                this.isCancelling = false;
                this.isProcessDone = false;
                this.isResultRevealing = false;
                this.progressRate = 0;
                this.procFinalCostSeconds = null;
                this.progressTip = '';
                this.designDots = [];
                this.processFailureDialogOpen = false;
                this.safeProcessingMode = false;
                this.activeBatchItemId = null;
                if (!options.keepBatch) {
                    this.batchCancelRequested = false;
                    this.clearBatchResults();
                    this.isBatchActive = false;
                    this.isBatchProcessing = false;
                    this.batchItems = [];
                    this.selectedBatchItemId = null;
                    this.batchRunId += 1;
                }
                this.previewOverlapRate = 50;
                this.previewZoom = this.previewZoomMin;
                this.previewViewportWidth = 0;
                this.previewViewportHeight = 0;
                this.resetPreviewPan();
                this.resetTheme();
                this.scheduleStageLayoutSync();
                let uploadCanvas = document.getElementById('canvas-upload');
                let outputCanvas = document.getElementById('canvas-output');
                if (uploadCanvas) {
                    uploadCanvas.width = 0;
                    uploadCanvas.height = 0;
                }
                if (outputCanvas) {
                    outputCanvas.width = 0;
                    outputCanvas.height = 0;
                }
            },

            clearBatchResults() {
                this.batchItems.forEach((item) => {
                    if (item.previewObjectUrl) {
                        URL.revokeObjectURL(item.previewObjectUrl);
                    }
                    if (item.objectUrl) {
                        URL.revokeObjectURL(item.objectUrl);
                    }
                });
            },

            runTestCase() {
                this.preloadSelectedModelAssets();
                this.ensureWasmLoaded()
                    .then(() => this.loadTestCase())
                    .catch(() => {});
            },

            loadTestCase() {
                let filename = 'test-img.png';
                let canvas = document.getElementById('canvas-upload');
                let ctx = canvas.getContext('2d');
                let img = new Image();
                img.onload = () => {
                    canvas.width = img.width;
                    canvas.height = img.height;
                    ctx.drawImage(img, 0, 0);
                    this.uploadPreviewWidth = img.width;
                    this.uploadPreviewHeight = img.height;
                    this.uploadPreviewName = filename;
                    this.scheduleStageLayoutSync();
                    this.applyImageThemeFromCanvas(canvas);
                    this.buildWebReDots(canvas);
                    this.scrollStageIntoView();
                    this.progressTip = '';
                }
                img.onerror = () => {
                    this.uploadImgSrc = '';
                    this.progressTip = '';
                    this.handleProcessFailure('failed to decode input image');
                }
                img.src = filename;
                this.uploadImgSrc = img.src;
            }
        }
    });
});
