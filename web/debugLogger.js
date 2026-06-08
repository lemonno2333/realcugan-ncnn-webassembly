// Shared debug logger for the static Real-CUGAN web app.
(function (root) {
    const LEVELS = {
        silent: 0,
        error: 1,
        warn: 2,
        info: 3,
        debug: 4,
    };
    const DEFAULT_LEVEL = 'warn';
    const STORAGE_KEY = 'realcuganDebug';

    function getSearchLevel() {
        try {
            const params = new URLSearchParams(root.location && root.location.search ? root.location.search : '');
            return params.get('debug') || params.get('log');
        } catch (error) {
            return '';
        }
    }

    function normalizeLevel(value) {
        if (value === true || value === '1' || value === 'true') {
            return 'debug';
        }
        if (value === false || value === '0' || value === 'false') {
            return DEFAULT_LEVEL;
        }
        value = (value || '').toString().toLowerCase();
        return Object.prototype.hasOwnProperty.call(LEVELS, value) ? value : DEFAULT_LEVEL;
    }

    function readStoredLevel() {
        try {
            return root.localStorage && root.localStorage.getItem(STORAGE_KEY);
        } catch (error) {
            return '';
        }
    }

    function resolveLevel() {
        return normalizeLevel(getSearchLevel() || readStoredLevel());
    }

    function shouldLog(currentLevel, targetLevel) {
        return LEVELS[currentLevel] >= LEVELS[targetLevel];
    }

    function write(method, args) {
        const consoleRef = root.console;
        if (!consoleRef) {
            return;
        }
        const fn = consoleRef[method] || consoleRef.log;
        if (typeof fn === 'function') {
            fn.apply(consoleRef, args);
        }
    }

    const logger = {
        level: resolveLevel(),
        setLevel(level) {
            this.level = normalizeLevel(level);
            try {
                if (root.localStorage) {
                    root.localStorage.setItem(STORAGE_KEY, this.level);
                }
            } catch (error) {
                // Storage may be disabled.
            }
        },
        debug() {
            if (shouldLog(this.level, 'debug')) {
                write('debug', arguments);
            }
        },
        info() {
            if (shouldLog(this.level, 'info')) {
                write('info', arguments);
            }
        },
        warn() {
            if (shouldLog(this.level, 'warn')) {
                write('warn', arguments);
            }
        },
        error() {
            if (shouldLog(this.level, 'error')) {
                write('error', arguments);
            }
        },
    };

    root.RealCuganLogger = logger;
})(typeof self !== 'undefined' ? self : window);
