'use strict';
/* global chrome */

(() => {
    // Script should only run once

    if (hasProperty(window, 'Elements')) return
    
    var Targets = new Set();
    
    function API(e) {
    	document.dispatchEvent(new CustomEvent('autopause_action', {detail: e}));
    }
    
    var Elements = new Map();
    
    var jsPlaying = false;
    var domPlaying = false;

    chrome.runtime.onMessage.addListener(message => {
        switch (message) {
        case 'toggleFastPlayback':
            API('toggleFastPlayback')
            toggleRate();
            break
        case 'Rewind':
            API('Rewind');
            Rewind();
            break
        case 'togglePlayback':
            API('togglePlayback');
            togglePlayback();
            break
        case 'allowplayback':
            API('allowplayback');
            resume(false);
            break
        case 'next':
            API('next');
            next();
            break
        case 'previous':
            API('previous');
            previous();
            break
        case 'pause':
            API('pause');
            pause();
            break
        case 'play':
            API('play');
            // When there media already playing tell the background script.
            if (isPlaying())
                send('play');
            resume(true);
            break
        case 'audible':
            checkShadow();
            break
        }
    });

    function checkSession() {
        if (jsPlaying || domPlaying) return
        send('pause');
    }
    
    function togglePlayback() {
        Elements.forEach((data, e) => {
            if (e.paused) return;
            if (data.togglePause) {
                data.togglePause = false;
                e.playbackRate = data.wasPlaybackRate;
            } else {
                data.togglePause = true;
                data.wasPlaying = false;
                data.wasPlaybackRate = e.playbackRate;
                e.playbackRate = 0;
            }
            Elements.set(e, data);
        });
    }

    function isPlaying() {
        checkShadow();
        const audibleElements = [...Elements].filter((data, e) => !e.muted);
        return (audibleElements.length !== 0);
    }

    function isPaused(e) {
        return (e.paused || e.playbackRate === 0);
    }

    function next() {
        Elements.forEach((data, e) => {
            if (isPaused(e)) return;
            e.currentTime = e.duration;
        });
    }

    function previous() {
        Elements.forEach((data, e) => {
            if (isPaused(e)) return;
            // Unknown
            e.currentTime = 0;
        });
    }

    // Controlled by global fast forward shortcut
    function toggleRate() {
        Elements.forEach((data, e) => {
            if (isPaused(e))
                return;
            if (data.wasPlaybackRate && e.playbackRate > 1) {
                e.playbackRate = data.wasPlaybackRate;
            } else {
                data.wasPlaybackRate = e.playbackRate;
                Elements.set(e, data);
                e.playbackRate = 2;
            }
        });
    }

    // Controlled by global rewind shortcut
    function Rewind() {
        Elements.forEach((data, e) => {
            if (isPaused(e))
                return;
	    e.currentTime -= 30;
        });
    }
    
    function onPlay(e) {
        if (e.muted) {
            send('playMuted');
        } else {
            domPlaying = true;
            send('play');
        }
    }
    
    function addListener(src) {
        if (Targets.has(src)) return
        Targets.add(src);
        let controller = new AbortController();
        // On media play event
        
        src.addEventListener('play', function (event) {
            if (event.srcElement instanceof HTMLMediaElement) {
                Elements.set(event.srcElement, {});
                onPlay(event.srcElement, event.isTrusted);
            }
        }, {
            signal: controller.signal,
            capture: true,
            passive: true
        });
        
        src.addEventListener('volumechange', function (event) {
            if (event.srcElement instanceof HTMLMediaElement && !isPaused(src)) {
                onPlay(event.srcElement);
            }
        }, {
            signal: controller.signal,
            capture: true,
            passive: true
        });
        
        src.addEventListener('pause', async event => {
            await sleep(200);
            onPause(event.srcElement);
        }, {
            signal: controller.signal,
            capture: true,
            passive: true
        });
        
        src.addEventListener('abort', event => {
            onPause(event.srcElement);
        }, {
            signal: controller.signal,
            capture: true,
            passive: true
        });
        
        // Dont tell the media please
        src.addEventListener('ratechange', function (event) {
            if (event.srcElement instanceof HTMLMediaElement) {
                let data = Elements.has(event.srcElement) ? Elements.get(event.srcElement) : {};
                if (event.srcElement.playbackRate === 0 && data.wasPlaying) {
                    event.stopPropagation();
                }
                if (!isPaused(event.srcElement)) {
                    onPlay(event.srcElement);
                }
            }
        }, {
            signal: controller.signal,
            capture: true
        });
    }
    
    addListener(document);

    function onPause(src) {
        if (src instanceof HTMLMediaElement && src.paused) {
            // Check if all elements have paused.
            Elements.delete(src);
            normalPlayback(src);
            if (!isPlaying()) {
                domPlaying = false;
                checkSession();
            }
        }
    }

    function normalPlayback(src) {
        let data = Elements.has(src) ? Elements.get(src) : {};
        if (data.wasPlaying) {
            src.volume = data.wasVolume;
            src.playbackRate = data.wasPlaybackRate;
            data.wasPlaying = false;
        }
    }

    function pauseElement(e, data) {
        // If media attempts to play when it should be paused dont change its old values.
        if (!data.wasPlaying) {
            data.wasVolume = e.volume;
            data.wasPlaybackRate = e.playbackRate;
        }
        // Rate change event will stopPropagation.
        data.wasPlaying = true;
        e.playbackRate = 0;
        e.volume = 0;
        Elements.set(e, data);
    }

    async function pause() {
        Elements.forEach((data, e) => {
            if (isPaused(e)) return;
            pauseElement(e, data);
        });
    }

    async function resume(shouldPlay) {
        Elements.forEach((data, e) => {
            if (!data.wasPlaying) return
            // Pause foreground media normaly
            if (shouldPlay === false)
                e.pause();
            normalPlayback(e);
        });
    }
    
    function checkShadow(DOM = document) {
        [...DOM.querySelectorAll('*')].map(e => {
            if (e instanceof HTMLElement) {
                let shadowDOM = shadow(e);
                if (shadowDOM !== null) {
                    checkShadow(shadowDOM);
                    addListener(shadowDOM);
                    [...shadowDOM.querySelectorAll('*')].map(e => {
                        if (!isPaused(e)) {
                            if (e instanceof HTMLMediaElement) {
                                Elements.set(e, {});
                                onPlay(e);
                            }
                        }
                    });
                }
            }
        });
    }

    document.addEventListener("autopause_result", e => {
	    switch(e.detail) {
            case 'play':
                jsPlaying = true;
                send('play');
                break
            case 'playMuted':
                send('playMuted');
                break
            case 'pause':
                jsPlaying = false;
                checkSession();
                break
	    }
    });

    function injectScript(filePath) {
        var script = document.createElement('script');
        script.setAttribute('type', 'text/javascript');
        script.setAttribute('crossorigin', 'anonymous');
        script.setAttribute('src', chrome.runtime.getURL(filePath));
        try {
            document.head.appendChild(script);
        } catch (e) {
            // May be blocked by CSP.
        }
    }
    
    function send(message) {
	    chrome.runtime.sendMessage(message);
    }
    
    window.addEventListener('DOMContentLoaded', () => {
        // Adds content to DOM needed because of isolation
        injectScript('WindowScript.js');
    }, {
        passive: true
    });

    window.addEventListener('pagehide', () => {
        send('pause');
    }, {
        passive: true
    });

    function checkVisibility() {
        if (document.visibilityState == 'hidden' && !document.pictureInPictureElement) {
          checkShadow();
          send('hidden');	
        }
    }

    window.addEventListener('visibilitychange', checkVisibility, {
        capture: true,
        passive: true
    });
    
    function hasProperty(value, key) {
        return Object.prototype.hasOwnProperty.call(value, key);
    }

    function shadow(e) {
        if ('openOrClosedShadowRoot' in e) {
            return e.openOrClosedShadowRoot;
        } else {
            return chrome.dom.openOrClosedShadowRoot(e);
        }
    }
    
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    // End of code
})();
