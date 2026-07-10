/**
 * Shared state, DOM element references, and utility helpers.
 * Every renderer module imports from here — single source of truth.
 */

export const $ = (id) => document.getElementById(id);

export const els = {
  textInput: $('text-input'), charCount: $('char-count'),
  voiceSelect: $('voice-select'), btnAddVoice: $('btn-add-voice'),
  btnSynth: $('btn-synth'), btnRestart: $('btn-restart'), btnOutput: $('btn-output'),
  spinnerSynth: $('spinner-synth'),
  sentenceList: $('sentence-list'), btnPlayAll: $('btn-play-all'),
  progressWrap: $('progress-wrap'), progressFill: $('progress-fill'), progressText: $('progress-text'),
  dotStatus: $('dot-status'), textStatus: $('text-status'),
  emotionChips: $('emotion-chips'), styleChips: $('style-chips'),
  prosodyChips: $('prosody-chips'), sfxChips: $('sfx-chips'),
  cloneModal: $('clone-modal'), cloneName: $('clone-name'), cloneLanguage: $('clone-language'), cloneAudio: $('clone-audio'),
  cloneTranscript: $('clone-transcript'), btnCloneCancel: $('btn-clone-cancel'), btnCloneSave: $('btn-clone-save'),
  toast: $('toast'),
  inputLang: $('input-lang'),
  settingsSummary: $('settings-summary'),
  sessionCards: $('session-cards'), actionBubble: $('action-bubble'), btnClearHistory: $('btn-clear-history'),
  emotionCount: $('emotion-count'), styleCount: $('style-count'),
  prosodyCount: $('prosody-count'), sfxCount: $('sfx-count'),
  btnSettings: $('btn-settings'), settingsModal: $('settings-modal'),
  settingTemperature: $('setting-temperature'), settingTopK: $('setting-topk'),
  settingTopP: $('setting-topp'), settingTokens: $('setting-tokens'),
  tempValue: $('temp-value'), topkValue: $('topk-value'), toppValue: $('topp-value'), tokensValue: $('tokens-value'),
  btnSettingsClose: $('btn-settings-close'), btnSettingsReset: $('btn-settings-reset'),
  settingDefaultVoice: $('setting-default-voice'),
  btnTheme: $('btn-theme'),
  btnInfo: $('btn-info'), tooltipPanel: $('tooltip-panel'),
  btnExportWav: $('btn-export-wav'), btnSaveM3u: $('btn-save-m3u'),
};

/** Human-readable labels for control tokens. */
export const LABELS = {
  // Emotions
  elation: 'Elation', amusement: 'Amusement', enthusiasm: 'Enthusiasm',
  determination: 'Determination', pride: 'Pride', contentment: 'Contentment',
  affection: 'Affection', relief: 'Relief', contemplation: 'Contemplation',
  confusion: 'Confusion', surprise: 'Surprise', awe: 'Awe',
  longing: 'Longing', arousal: 'Arousal', anger: 'Anger',
  fear: 'Fear', disgust: 'Disgust', bitterness: 'Bitterness',
  sadness: 'Sadness', shame: 'Shame', helplessness: 'Helplessness',
  // Prosody
  speed_very_slow: 'Very slow', speed_slow: 'Slow',
  speed_fast: 'Fast', speed_very_fast: 'Very fast',
  pitch_low: 'Low pitch', pitch_high: 'High pitch',
  pause: 'Pause', long_pause: 'Long pause',
  expressive_high: 'Dramatic', expressive_low: 'Monotone',
  singing: 'Singing', shouting: 'Shouting', whispering: 'Whispering',
};

/** Application state — mutated by feature modules. */
export const state = {
  voices: [], selectedVoice: "default",
  emotion: null, style: null, prosody: new Set(), sfx: new Map(),
  sglangReady: false,
  flaskUrl: 'http://127.0.0.1:7861',
  sentences: [],
  playbackIndex: -1,
  _abortController: null,
  temperature: 0.8, topK: 50, topP: 0.9, maxTokens: 2048,
};
