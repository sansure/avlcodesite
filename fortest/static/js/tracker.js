/**
 * AVL Code 站长统计 - 前端追踪脚本 (纯静态版本)
 * 
 * 追踪数据传输链接直接硬编码，无需服务端动态生成。
 * 统计服务器地址: https://site.avlcodesite.xyz
 */
(function() {
    'use strict';

    var STATS_SERVER = 'https://site.avlcodesite.xyz';
    var TRACK_URL = STATS_SERVER + '/track';
    var VIEW_URL = STATS_SERVER + '/track/view';

    /**
     * 通过 sendBeacon 发送追踪数据（页面卸载时也能可靠发送）
     */
    function sendTrack(data) {
        try {
            var payload = JSON.stringify(data);
            if (navigator.sendBeacon) {
                navigator.sendBeacon(TRACK_URL, payload);
            } else {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', TRACK_URL, true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(payload);
            }
        } catch(e) {
            console.warn('AVL Stats: 发送追踪数据失败', e);
        }
    }

    /**
     * 通过 1x1 GIF 发送页面浏览事件（兼容所有浏览器）
     */
    function sendView(pageUrl, pageTitle) {
        try {
            var img = new Image();
            img.src = VIEW_URL + '?page_url=' + encodeURIComponent(pageUrl || window.location.pathname) +
                      '&page_title=' + encodeURIComponent(pageTitle || document.title) +
                      '&t=' + Date.now();
        } catch(e) {
            console.warn('AVL Stats: 发送浏览事件失败', e);
        }
    }

    // 暴露全局 API
    window.AVLStats = {
        track: sendTrack,
        trackView: sendView,
        trackDownload: function(itemName) {
            sendTrack({
                page_url: window.location.pathname,
                page_title: document.title,
                is_download: 1,
                download_item: itemName
            });
        }
    };

    // 页面加载时自动发送浏览事件
    window.addEventListener('load', function() {
        window.__pageLoadTime = Date.now();
        sendView(window.location.pathname, document.title);
    });

    // 页面卸载时发送停留时长
    window.addEventListener('beforeunload', function() {
        var loadTime = window.__pageLoadTime || Date.now();
        var duration = Math.round((Date.now() - loadTime) / 1000);
        if (duration > 0) {
            sendTrack({
                page_url: window.location.pathname,
                page_title: document.title,
                duration: duration
            });
        }
    });
})();