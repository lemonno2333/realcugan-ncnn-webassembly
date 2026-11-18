// Shared Vue template for Real-CUGAN and GPT denoise. Edit this file, not generated entry pages.
window.APP_TEMPLATE = String.raw`
    <div class="rel design-root" style="min-height:100vh;min-height:100dvh">
        <div class="ambient-proc" :class="{'is-on': isProcessing || isResultRevealing}" aria-hidden="true"><span></span><span></span><span></span></div>
        <svg class="grain-svg" aria-hidden="true"><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"></feTurbulence><feColorMatrix type="saturate" values="0"></feColorMatrix></filter><rect width="100%" height="100%" filter="url(#grain)"></rect></svg>
        <span class="vc vc-tl"></span><span class="vc vc-tr"></span><span class="vc vc-bl"></span><span class="vc vc-br"></span>
        <span data-parallax="2.4" class="float-word decor-upscale">UPSCALE</span>
        <span data-parallax="2.8" class="float-word decor-device">ON_DEVICE</span>
        <div class="fill design-sparkles" aria-hidden="true">
            <span class="sparkle" style="left:8%;top:22%;color:var(--c-primary)"><span class="fl" style="--fd:6s"><span class="tw" style="--td:3s"><span class="sparkle-glyph">✦</span></span></span></span>
            <span class="sparkle" style="left:90%;top:30%;color:var(--c-tertiary)"><span class="fl" style="--fd:7s"><span class="tw" style="--td:2.4s"><span class="sparkle-glyph">✧</span></span></span></span>
            <span class="sparkle" style="left:78%;top:70%;color:var(--c-secondary)"><span class="fl" style="--fd:8s"><span class="tw" style="--td:3.6s"><span class="sparkle-glyph">✦</span></span></span></span>
            <span class="sparkle" style="left:16%;top:78%;color:var(--c-primary)"><span class="fl" style="--fd:6.5s"><span class="tw" style="--td:2.8s"><span class="sparkle-glyph">✧</span></span></span></span>
            <span class="sparkle" style="left:52%;top:12%;color:var(--c-tertiary)"><span class="fl" style="--fd:5.5s"><span class="tw" style="--td:2.2s"><span class="sparkle-glyph">✦</span></span></span></span>
            <span class="sparkle" style="left:40%;top:88%;color:var(--c-secondary)"><span class="fl" style="--fd:7.5s"><span class="tw" style="--td:3.2s"><span class="sparkle-glyph">✧</span></span></span></span>
        </div>
        <el-container>
            <div class="floating-preferences topnav" :inert="isMobile && mobileSettingsVisible ? '' : null">
                <a v-if="isGpt" href="/" class="topnav-denoise-link">Real-CUGAN</a>
                <a v-else href="gpt-denoise.html" class="topnav-denoise-link">GPT <span v-if="language === 'zh'">去噪</span><span v-else-if="language === 'ja'">ノイズ除去</span><span v-else>Denoise</span></a>
                <el-dropdown trigger="click" v-on:command="setLanguage">
                    <el-button circle class="topnav-btn" :aria-label="t('nav.language') + ': ' + getLanguageLabel()" :title="t('nav.language') + ': ' + getLanguageLabel()">
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></g>
                        </svg>
                    </el-button>
                    <el-dropdown-menu slot="dropdown">
                        <el-dropdown-item command="zh" :class="{'is-current': language === 'zh'}">中文</el-dropdown-item>
                        <el-dropdown-item command="en" :class="{'is-current': language === 'en'}">English</el-dropdown-item>
                        <el-dropdown-item command="ja" :class="{'is-current': language === 'ja'}">日本語</el-dropdown-item>
                    </el-dropdown-menu>
                </el-dropdown>
                <el-dropdown trigger="click" v-on:command="setThemeMode">
                    <el-button circle class="topnav-btn" :aria-label="t('nav.theme') + ': ' + getThemeModeLabel()" :title="t('nav.theme') + ': ' + getThemeModeLabel()">
                        <svg v-if="getEffectiveTheme() === 'dark'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"></path></svg>
                        <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path></svg>
                    </el-button>
                    <el-dropdown-menu slot="dropdown">
                        <el-dropdown-item command="auto" :class="{'is-current': themeMode === 'auto'}">{{t('theme.auto')}}</el-dropdown-item>
                        <el-dropdown-item command="light" :class="{'is-current': themeMode === 'light'}">{{t('theme.light')}}</el-dropdown-item>
                        <el-dropdown-item command="dark" :class="{'is-current': themeMode === 'dark'}">{{t('theme.dark')}}</el-dropdown-item>
                    </el-dropdown-menu>
                </el-dropdown>
            </div>

            <el-main ref="appMain" class="app-main shell app-main-adaptive"
                     :class="{'mobile-settings-open': isMobile && mobileSettingsVisible}">
                <header :inert="isMobile && mobileSettingsVisible ? '' : null" class="shell-head" data-reveal="up">
                    <div class="brand-stroke" data-parallax="1.2" style="user-select:none" :aria-label="t('app.title')">
                        <span>REAL—CUGAN</span>
                        <span class="brand-solid">{{t('app.brandSuffix')}}</span>
                    </div>
                </header>
                <div ref="workspace" class="workspace console-grid workspace-adaptive" :style="getWorkspaceStyle()">
                    <aside id="settings-panel" :aria-label="t('controls.params')" :inert="isMobile && !mobileSettingsVisible ? '' : null" ref="controlPanel" class="control-panel card card-ctl ctl" data-reveal="up"
                           :class="{'mobile-drawer-open': isMobile && mobileSettingsVisible}"
                           :role="isMobile && mobileSettingsVisible ? 'dialog' : null"
                           :aria-modal="isMobile && mobileSettingsVisible ? 'true' : null">
                        <div class="card-head">
                            <div class="lay lay-ic g2">
                                <svg class="c-sig" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 4.8L18.7 9.7 13.9 11.6 12 16.4 10.1 11.6 5.3 9.7 10.1 7.8z"></path><path d="M19 14l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"></path></svg>
                                <span class="ml c-sig">{{t('controls.params')}}</span>
                                <el-popover v-model="projectInfoVisible" :placement="infoPopoverPlacement" trigger="manual" popper-class="info-popover" width="300">
                                    <div class="info-popover-content">
                                        <p>{{t('help.localPrefix')}}<b>{{t('help.localStrong')}}</b>{{t('help.localSuffix')}}</p>
                                        <p><b>{{t('help.noticeTitle')}}</b>{{t('help.noticeText')}}</p>
                                        <p><b>{{t('help.scaleTitle')}}</b>{{t('help.scaleText')}}</p>
                                        <p><b>{{t('help.denoiseTitle')}}</b>{{t('help.denoiseText')}}</p>
                                    </div>
                                    <button slot="reference" type="button" class="info-button" :aria-label="t('help.projectInfoLabel')" v-on:mouseenter="showInfoPopover" v-on:mouseleave="hideInfoPopover" v-on:touchstart.stop.prevent="toggleInfoPopover" v-on:click.stop="toggleInfoPopover">i</button>
                                </el-popover>
                            </div>
                            <div class="lay lay-ic g2">
                                <span class="ml-sm c-mute">/ 01</span>
                                <button v-if="isMobile" ref="drawerCloseButton" type="button" class="mobile-drawer-close" v-on:click="closeMobileSettings" :aria-label="t('actions.close')"><i class="el-icon-close" aria-hidden="true"></i></button>
                            </div>
                        </div>
                        <div class="card-div"></div>

                        <div class="card-body">
                            <div class="field" v-if="!isGpt">
                                <div class="field-l">{{t('controls.model')}}</div>
                                <el-radio-group v-model="modelTypeRadio" v-on:change="onModelTypeOptionChange" size="small" class="w100" style="display:flex">
                                    <el-radio-button label="se" style="flex:1">{{t('model.se')}}</el-radio-button>
                                    <el-radio-button label="pro" style="flex:1">{{t('model.pro')}}</el-radio-button>
                                </el-radio-group>
                            </div>

                            <div class="field" v-if="!isGpt">
                                <div class="field-l">{{t('controls.scale')}}</div>
                                <div class="scale-row">
                                    <div v-for="scale in [2, 3, 4]" :key="scale" class="scale-cell" :style="{flex: isDesignScaleHidden(scale) ? '0 0 0px' : '1 1 0%', opacity: isDesignScaleHidden(scale) ? 0 : 1, transform: isDesignScaleHidden(scale) ? 'scale(0.7)' : 'scale(1)', pointerEvents: isDesignScaleHidden(scale) ? 'none' : 'auto'}">
                                        <button type="button" class="scale-num" :class="{'is-on': scaleRadio === scale}" :tabindex="isDesignScaleHidden(scale) ? -1 : 0" v-on:click="setDesignScale(scale)">{{scale}}<sup>×</sup></button>
                                    </div>
                                    <div class="scale-bar-track" aria-hidden="true"><div class="scale-bar" :style="{left: getDesignScaleBarLeft() + '%', width: (100 / getVisibleDesignScales().length) + '%'}"></div></div>
                                </div>
                            </div>

                            <div class="field" v-if="!isGpt">
                                <div class="field-l">{{t('controls.denoise')}}</div>
                                <div class="denoise-row" :class="{'is-scrub': designDenoiseScrubbing}" v-on:pointerdown="startDesignDenoiseScrub" v-on:pointermove="moveDesignDenoiseScrub" v-on:pointerup="endDesignDenoiseScrub" v-on:pointercancel="endDesignDenoiseScrub">
                                    <div v-for="option in getDesignDenoiseOptions()" :key="option.value" class="denoise-cell" :style="{maxWidth: isDenoiseDisabled(option.value) ? '0px' : '120px', opacity: isDenoiseDisabled(option.value) ? 0 : 1, transform: isDenoiseDisabled(option.value) ? 'scale(0.7) translateY(8px)' : 'scale(1) translateY(0)', pointerEvents: isDenoiseDisabled(option.value) ? 'none' : 'auto'}">
                                        <button type="button" class="tick" :class="{'is-on': denoiseRadio === option.value}" :tabindex="isDenoiseDisabled(option.value) ? -1 : 0" v-on:click="setDesignDenoise(option.value)"><span class="bar"></span><span style="font-size:10.5px">{{option.label}}</span></button>
                                    </div>
                                </div>
                            </div>

                            <div class="field" v-if="!isGpt">
                                <div class="field-l">{{t('controls.backendMode')}}</div>
                                <el-radio-group v-model="backendMode" v-on:change="onBackendModeChange" size="small" class="w100" style="display:flex">
                                    <el-radio-button label="auto" style="flex:1">{{t('backend.auto')}}</el-radio-button>
                                    <el-radio-button label="simd-threads" style="flex:1">{{t('backend.threads')}}</el-radio-button>
                                    <el-radio-button label="simd" style="flex:1">SIMD</el-radio-button>
                                    <el-radio-button label="basic" style="flex:1">{{t('backend.basic')}}</el-radio-button>
                                </el-radio-group>
                            </div>

                            <template v-if="isGpt">
                                <div class="field gpt-method">
                                    <div class="field-l">{{t('gpt.method')}}</div>
                                    <el-radio-group v-model="gptMethod" :disabled="isProcessing || isBatchProcessing" size="small" class="w100" style="display:flex">
                                        <el-radio-button label="esrgan" style="flex:1">ESRGAN + L0</el-radio-button>
                                        <el-radio-button label="l0" style="flex:1">{{t('gpt.l0Only')}}</el-radio-button>
                                    </el-radio-group>
                                </div>
                                <div class="field gpt-down">
                                    <div class="field-l">{{t('gpt.down')}} <span class="c-mute">{{gptDown}}%</span></div>
                                    <el-slider :label="t('gpt.down')" v-model="gptDown" :min="10" :max="100" :step="1" :disabled="isProcessing || isBatchProcessing || gptMethod === 'l0'"></el-slider>
                                </div>
                                <div class="field gpt-strength">
                                    <div class="field-l">{{t('gpt.strength')}}</div>
                                    <el-input-number :label="t('gpt.strength')" v-model="gptLambda" :min="0" :max="0.01" :step="0.0001" :precision="4" :disabled="isProcessing || isBatchProcessing" size="small" class="w100"></el-input-number>
                                </div>
                                <div class="field">
                                    <div class="field-l">{{t('gpt.recipe')}}</div>
                                    <span class="c-mute">{{getGptRecipe()}}</span>
                                </div>
                            </template>
                            <div class="ctl-foot">
                                <div class="lay g2 w100 action-section">
                                    <el-button size="small" round class="eb" style="flex:1" :loading="wasmLoading" v-if="!isProcessing && uploadPreviewWidth === 0" v-on:click="runTestCase(); closeMobileSettings()"><svg class="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="13" height="13" rx="2"></rect><path d="M21 8v11a2 2 0 0 1-2 2H8"></path><circle cx="8" cy="8" r="1.4"></circle><path d="M3 13l3-3 4 4"></path></svg><span>{{t('actions.sample')}}</span></el-button>
                                    <el-button size="small" round class="eb" style="flex:1" v-if="!isProcessing && uploadPreviewWidth !== 0" v-on:click="resetWorkspace(); closeMobileSettings()"><svg class="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4"></path><path d="M3 3v5h5"></path></svg><span>{{isBatchActive ? t('actions.clearBatch') : t('actions.reset')}}</span></el-button>
                                    <el-button size="small" round class="eb-accent save-cta" style="flex:1" v-if="isProcessDone && !isBatchActive" v-on:click="saveOutput(); closeMobileSettings()"><svg class="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path></svg><span>{{t('actions.save')}}</span></el-button>
                                    <el-button size="small" round class="eb-accent" style="flex:1" v-if="isBatchActive && batchDownloadCount > 0" v-on:click="downloadAllBatchResults(); closeMobileSettings()"><svg class="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path></svg><span>{{t('actions.downloadAll')}}</span></el-button>
                                    <el-button size="small" round class="eb" style="flex:1" :loading="isCancelling" :disabled="isCancelling" v-if="isProcessing && !isProcessDone" v-on:click="stopProcess(); closeMobileSettings()"><svg class="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"></path></svg><span>{{isCancelling ? t('actions.cancelling') : t('actions.cancel')}}</span></el-button>
                                </div>
                            </div>

                            <div class="field batch-section" v-if="isBatchActive || batchItems.length > 0">
                                <div class="field-l">{{t('batch.title')}}</div>
                            <div class="batch-summary">
                                <span>{{t('batch.summary', {done: batchDoneCount, total: batchItems.length})}}</span>
                                <span v-if="isBatchProcessing">{{t('batch.running')}}</span>
                            </div>
                            <el-progress class="batch-progress" :percentage="batchProgressRate"></el-progress>
                            <div class="batch-list" style="overflow-x: hidden; max-width: 100%; box-sizing: border-box;" v-if="batchItems.length > 0">
                                <div
                                        role="button"
                                        tabindex="0"
                                        class="batch-item"
                                        :class="{'is-selected': selectedBatchItemId === item.id, 'is-done': item.status === 'done'}"
                                        :style="getBatchItemStyle(item)"
                                        :aria-label="item.name + ' ' + t('batch.status.' + item.status)"
                                        v-for="item in batchItems"
                                        :key="item.id"
                                        v-on:click="selectBatchItem(item)"
                                        v-on:keydown.enter.prevent="selectBatchItem(item)"
                                        v-on:keydown.space.prevent="selectBatchItem(item)">
                                    <div class="batch-item-thumb" v-if="item.previewObjectUrl">
                                        <img :src="item.previewObjectUrl" alt="" />
                                        <span class="batch-thumb-check" v-if="item.status === 'done'" aria-hidden="true"><i class="el-icon-check"></i></span>
                                    </div>
                                    <span class="batch-item-name">
                                        {{item.name}}
                                        <span class="batch-item-progress" v-if="item.status === 'processing' && progressRate > 0" aria-hidden="true">
                                            <span :style="{width: progressRate + '%'}"></span>
                                        </span>
                                    </span>
                                    <span class="batch-item-action">
                                        <el-tag class="batch-status-tag" size="mini" :type="getBatchTagType(item.status)">{{t('batch.status.' + item.status)}}</el-tag>
                                        <button
                                                type="button"
                                                class="batch-download-button"
                                                v-if="item.status === 'done'"
                                                :style="getBatchDownloadButtonStyle(item)"
                                                :aria-label="t('actions.download') + ': ' + item.filename"
                                                :title="t('actions.download') + ': ' + item.filename"
                                                v-on:click.stop="downloadBatchItem(item)">
                                            <i class="el-icon-download" aria-hidden="true"></i>
                                        </button>
                                        <button
                                                type="button"
                                                class="batch-download-button"
                                                v-if="(item.status === 'error' || item.status === 'cancelled') && !isBatchProcessing && !isProcessing"
                                                :aria-label="t('actions.retry') + ': ' + item.name"
                                                :title="t('actions.retry') + ': ' + item.name"
                                                v-on:click.stop="retryBatchItem(item)">
                                            <i class="el-icon-refresh-right" aria-hidden="true"></i>
                                        </button>
                                    </span>
                                </div>
                            </div>
                            </div>
                        </div>
                    </aside>

                    <section :inert="isMobile && mobileSettingsVisible ? '' : null" ref="stagePanel" class="stage-panel card stage-panel-adaptive" data-reveal="up" style="--d:120ms"
                             :class="{'is-charging': isProcessing && progressRate > 0}"
                             :style="[getStagePanelStyle(), {'--charge': progressRate + '%'}]">
                        <div ref="stageToolbar" class="stage-toolbar stage-head">
                            <div class="lay lay-ic g3 wrap">
                                <svg class="slowspin c-sig" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m14.3 8 5.7 9.9"></path><path d="M9.7 8h11.5"></path><path d="m7.4 12 5.7-9.9"></path><path d="M9.7 16 4 6.1"></path><path d="M14.3 16H2.8"></path><path d="m16.6 12-5.7 9.9"></path></svg>
                                <div>
                                    <div class="stage-eyebrow" v-if="isMobile && !uploadPreviewName">Real-CUGAN Web</div>
                                    <div class="stage-title">
                                        <template v-if="uploadPreviewName">{{uploadPreviewName}}</template>
                                        <template v-else-if="isMobile">{{t('app.heading')}}</template>
                                        <template v-else>{{t('stage.workspace')}}</template>
                                    </div>
                                    <div class="stage-meta" v-if="uploadPreviewWidth !== 0">
                                        {{uploadPreviewWidth}} × {{uploadPreviewHeight}} -> {{outputPreviewWidth || uploadPreviewWidth * (isGpt ? 1 : scaleRadio)}} × {{outputPreviewHeight || uploadPreviewHeight * (isGpt ? 1 : scaleRadio)}}
                                    </div>
                                    <div class="stage-meta" v-else>
                                        <span v-if="wasmLoading">{{getWasmLoadingText()}}</span>
                                        <span v-else>{{getCurrentParamsText}}</span>
                                    </div>
                                    <div class="stage-status" role="status" aria-live="polite" v-if="isProcessing || isProcessDone">
                                        {{progressTip}}
                                    </div>
                                </div>
                                <span class="pill" style="width:6px;height:6px" :style="{background: isProcessing ? 'var(--c-primary)' : isProcessDone ? 'var(--c-secondary)' : 'var(--mute)', boxShadow: isProcessing ? '0 0 8px var(--c-primary)' : 'none'}"></span>
                            </div>
                            <div class="preview-tools" v-if="isProcessDone">
                                <el-button size="mini" v-on:click="zoomOutPreview" :disabled="previewZoom <= previewZoomMin">{{t('preview.zoomOut')}}</el-button>
                                <button type="button" class="zoom-readout" :title="'100%'" v-on:click="resetPreviewZoom">{{Math.round(previewZoom)}}%</button>
                                <el-button size="mini" v-on:click="zoomInPreview" :disabled="previewZoom >= previewZoomMax">{{t('preview.zoomIn')}}</el-button>
                            </div>
                        </div>
                        <div class="stage-line"></div>

                        <div ref="stageSurface" :inert="isMobile && mobileSettingsVisible ? '' : null"
                             class="stage-body stage-vp"
                             :class="[
                                 getStageSurfaceClass(getCurrentStageKind()),
                                 {
                                     'processing-stage': uploadPreviewWidth !== 0 && !isProcessDone,
                                     'result-stage': isProcessDone,
                                     'result-overlap': isProcessDone,
                                     'is-revealing': isResultRevealing
                                 }
                             ]"
                             :style="getStageSurfaceStyle(getCurrentStageKind())">
                            <span class="hud" style="top:10px;left:10px;border-top:2px solid;border-left:2px solid"></span>
                            <span class="hud" style="top:10px;right:10px;border-top:2px solid;border-right:2px solid"></span>
                            <span class="hud" style="bottom:10px;left:10px;border-bottom:2px solid;border-left:2px solid"></span>
                            <span class="hud" style="bottom:10px;right:10px;border-bottom:2px solid;border-right:2px solid"></span>
                            <div class="mesh liquid is-on"
                                 v-if="isProcessing || isResultRevealing"
                                 :class="{'is-reveal': isResultRevealing}"
                                 aria-hidden="true">
                                <span></span>
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                            <div class="dot-grid"
                                 v-if="isProcessing || isResultRevealing"
                                 :class="{'dots-fade': isResultRevealing}"
                                 aria-hidden="true">
                                <span v-for="(dot, index) in designDots"
                                      :key="index"
                                      class="dot-pop"
                                      :style="{left: dot.nx * 100 + '%', top: dot.ny * 100 + '%', background: dot.color, '--delay': dot.delay + 's', boxShadow: '0 0 5px ' + dot.color}">
                                </span>
                            </div>

                            <!-- Empty Upload State -->
                            <div v-if="uploadPreviewWidth === 0 && !isProcessDone" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
                                <div class="focus-lines" aria-hidden="true"></div>
                                <el-upload
                                        ref="imageUpload"
                                        class="large-upload"
                                        drag
                                        multiple
                                        :auto-upload="false"
                                        :disabled="wasmLoading"
                                        accept="image/png,image/jpeg,image/webp,image/bmp"
                                        :on-change="onUploadChange"
                                        action="https://jsonplaceholder.typicode.com/posts/">
                                    <div class="upload-loading-state" v-if="wasmLoading" aria-live="polite">
                                        <div class="upload-loading-orb" aria-hidden="true">
                                            <span></span>
                                            <span></span>
                                        </div>
                                        <div class="upload-loading-title">{{t('stage.loadingAssets')}}</div>
                                        <div class="upload-loading-progress">{{getWasmLoadingText()}}</div>
                                        <div class="upload-loading-bar" :class="{'is-indeterminate': !hasStableWasmProgress()}" aria-hidden="true">
                                            <span :style="{width: wasmLoadingProgress + '%'}"></span>
                                        </div>
                                    </div>
                                    <div v-if="!wasmLoading" class="run mb4" style="pointer-events:none" aria-hidden="true">
                                        <svg class="ring" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="48" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 6"></circle></svg>
                                        <svg class="ring2" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="48" stroke="currentColor" stroke-width="1.4" stroke-dasharray="14 10"></circle></svg>
                                        <span class="core"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"></path></svg></span>
                                    </div>
                                    <div class="el-upload__text" v-if="!wasmLoading">
                                        {{t('upload.drag')}}<em>{{t('upload.click')}}</em>
                                        <span class="upload-format-hint">{{t('upload.batchHint')}}</span>
                                    </div>
                                </el-upload>
                            </div>

                            <!-- Input Processing State -->
                            <template v-if="uploadPreviewWidth !== 0 && !isProcessDone">
                                <el-image
                                        v-if="uploadImgSrc"
                                        class="processing-preview"
                                        :class="{'lowres': isProcessing}"
                                        :preview-src-list="[uploadImgSrc]"
                                        :src="uploadImgSrc"
                                        :style="{width: getInputPreviewSize().width + 'px', height: getInputPreviewSize().height + 'px'}">
                                </el-image>
                                <div v-if="!isProcessing" class="ready-vignette"></div>
                                <div v-if="!isProcessing" class="ready-ui">
                                    <div class="wipe-stack">
                                        <div v-for="(txt, index) in getReadyWipeLines()" :key="txt" class="wipe-line" :style="'--d1:' + (0.12 + index * 0.46) + 's;--d2:' + (0.4 + index * 0.46) + 's'">
                                            <span class="wipe-mark"></span>
                                            <span class="wipe-bg"></span>
                                            <span class="wipe-base">{{txt}}</span>
                                            <span class="wipe-on">{{txt}}</span>
                                        </div>
                                    </div>
                                    <div class="fill lay lay-c ready-action-layer">
                                        <div class="ready-isle">
                                            <div class="ready-badge">✓ {{t('stage.ready')}}</div>
                                            <button type="button" class="btn-run" v-on:click="startReadyProcess">✦ {{t('stage.start')}}</button>
                                        </div>
                                    </div>
                                </div>
                                <div v-if="isProcessing" class="processing-ui">
                                    <div class="abs-c tc processing-hud">
                                        <div class="processing-number">{{progressRate}}<span>%</span></div>
                                        <!-- aria-hidden: same text as the live stage-status region; avoid double announcements -->
                                        <div class="processing-status" aria-hidden="true">{{progressTip}}</div>
                                        <el-button class="processing-cancel" size="mini" round :loading="isCancelling" :disabled="isCancelling" v-on:click.stop="stopProcess">{{isCancelling ? t('actions.cancelling') : t('actions.cancel')}}</el-button>
                                    </div>
                                </div>
                            </template>

                            <!-- Result State -->
                            <template v-if="isProcessDone">
                                <!-- ambient backdrop: blurred copy of the result bleeding its colours into the stage -->
                                <img v-if="outputImgSrc" class="stage-ambient-img" :src="outputImgSrc" alt="" aria-hidden="true" />
                                <div ref="previewViewport" class="preview-pan-viewport result-in"
                                     :class="{'is-draggable': previewZoom > previewZoomMin, 'is-dragging': previewDragging}"
                                     v-on:mousedown="startPreviewPan"
                                     v-on:dblclick.prevent="onPreviewDoubleClick"
                                     v-on:touchstart="startPreviewPan"
                                     v-on:touchmove="movePreviewPan"
                                     v-on:touchend="endPreviewPan"
                                     v-on:touchcancel="endPreviewPan"
                                     v-on:wheel.stop.prevent="onPreviewWheel">
                                    <div class="preview-pan-content"
                                         :style="{transform: 'translate(' + previewPanX + 'px, ' + previewPanY + 'px)'}">
                                        <div class="preview-overlap-container"
                                             :style="{width: zoomedPreviewSize.outputImgWidth + 'px', height: zoomedPreviewSize.outputImgHeight + 'px'}">
                                            <img
                                                    draggable="false"
                                                    class="preview-overlap-origin"
                                                    :src="uploadImgSrc"
                                                    :alt="t('preview.before') + ' — ' + uploadPreviewName"
                                                    :style="{width: zoomedPreviewSize.outputImgWidth + 'px', height: zoomedPreviewSize.outputImgHeight + 'px', clipPath: 'inset(0 0 0 ' + getPreviewSplitLocalX() + 'px)'}">
                                            <div
                                                    class="preview-overlap-output"
                                                    :style="{width: getPreviewSplitLocalX() + 'px', height: zoomedPreviewSize.outputImgHeight + 'px'}">
                                                <img
                                                        draggable="false"
                                                        class="preview-overlap-result"
                                                        :src="outputImgSrc"
                                                        :alt="t('preview.after') + ' — ' + uploadPreviewName"
                                                        :style="{width: zoomedPreviewSize.outputImgWidth + 'px', height: zoomedPreviewSize.outputImgHeight + 'px'}">
                                            </div>
                                        </div>
                                    </div>
                                    <div class="preview-split-indicator"
                                         :style="{left: getPreviewSplitViewportX() + 'px'}">
                                        <div class="preview-split-handle"
                                             role="slider"
                                             tabindex="0"
                                             :aria-label="t('preview.before') + ' / ' + t('preview.after')"
                                             :aria-valuenow="Math.round(previewOverlapRate)"
                                             aria-valuemin="0"
                                             aria-valuemax="100"
                                             v-on:mousedown.stop.prevent="startSplitDrag"
                                             v-on:touchstart.stop.prevent="startSplitDrag"
                                             v-on:keydown="onSplitHandleKeydown">
                                            <i class="el-icon-caret-left" style="margin-right: -2px;" aria-hidden="true"></i>
                                            <i class="el-icon-caret-right" style="margin-left: -2px;" aria-hidden="true"></i>
                                        </div>
                                    </div>
                                    <span class="chip compare-chip compare-before">{{t('preview.before')}}</span>
                                    <span class="chip compare-chip compare-after">{{t('preview.after')}}</span>
                                </div>
                            </template>
                        </div>

                        <div style="display: none;">
                            <canvas id="canvas-upload"></canvas>
                            <canvas id="canvas-output"></canvas>
                            <a id="download-link"></a>
                        </div>
                    </section>
                </div>

                <!-- Mobile Settings Drawer Backdrop -->
                <div class="mobile-drawer-backdrop" v-if="isMobile && mobileSettingsVisible" v-on:click="closeMobileSettings" v-on:touchmove.prevent></div>

                <!-- Floating Settings Action Button for Mobile -->
                <button
                    type="button"
                    ref="mobileSettingsFab" aria-controls="settings-panel" aria-expanded="false"
                    class="mobile-settings-fab"
                    v-if="isMobile && !mobileSettingsVisible"
                    v-on:click="openMobileSettings"
                    :aria-label="t('controls.settingsButton')">
                    <i class="el-icon-setting" aria-hidden="true"></i>
                    <span>{{t('controls.settingsButton')}}</span>
                </button>
            </el-main>
            <el-footer :inert="isMobile && mobileSettingsVisible ? '' : null" class="app-footer">
                <span>{{t('footer.version')}}: {{appVersion}}</span>
                <span>{{t('footer.backend')}}: {{wasmBackend || t('backend.detecting')}}</span>
                <a href="https://github.com/lemonno2333/realcugan-ncnn-webassembly" target="_blank">GitHub</a>
                <a href="https://github.com/hanFengSan/realcugan-ncnn-webassembly" target="_blank">{{t('nav.originalProject')}}</a>
                <a v-if="isGpt" href="https://github.com/CXP-2024/gpt-anime-denoise" target="_blank" rel="noopener noreferrer">GPT Anime Denoise</a>
                <a v-if="isGpt" href="THIRD_PARTY_NOTICES.md">{{t('gpt.licenses')}}</a>
                <a href="https://github.com/bilibili/ailab/tree/main/Real-CUGAN" target="_blank">Real-CUGAN</a>
                <a href="https://github.com/Tencent/ncnn" target="_blank">ncnn</a>
                <a href="https://github.com/emscripten-core/emscripten" target="_blank">emscripten</a>
            </el-footer>
        </el-container>
    </div>
`;
