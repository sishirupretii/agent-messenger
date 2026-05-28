import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /widget.js
 *
 * The drop-in JavaScript embed. Partners include one script tag +
 * one container element on their site and a SIGNA room widget
 * boots automatically:
 *
 *   <div data-signa-room="vorxis-164ba3" style="height:560px"></div>
 *   <script src="https://www.signaagent.xyz/widget.js" defer></script>
 *
 * The widget injects an auto-sized iframe pointing at
 * /rooms/[slug]/embed. The iframe inherits the container's width and
 * height (or a sensible 560px default) and exposes the wallet-connect
 * RainbowKit modal over the iframe just like /rooms/[slug] does.
 *
 * Auto-discovers ALL data-signa-room containers on the page so a
 * partner can drop multiple rooms (e.g. a tabbed UI listing several
 * Bankr token rooms) by adding more containers.
 *
 * Pure vanilla JS — no React / Vue / dependencies. Ships < 2 KB.
 * Served as application/javascript with a 1-hour edge cache so
 * partners get fast reloads.
 */

const SCRIPT = `/*! SIGNA widget.js · MIT */
(function(){
  var BASE = "https://www.signaagent.xyz";
  var MOUNT_ATTR = "data-signa-room";
  var MOUNTED = "data-signa-mounted";

  function mount(el) {
    if (el.getAttribute(MOUNTED) === "1") return;
    var slug = (el.getAttribute(MOUNT_ATTR) || "").toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) {
      el.innerHTML = '<div style="font-family:monospace;color:#888;padding:1em">SIGNA: invalid slug "'+slug+'"</div>';
      el.setAttribute(MOUNTED, "1");
      return;
    }
    var iframe = document.createElement("iframe");
    iframe.src = BASE + "/rooms/" + encodeURIComponent(slug) + "/embed";
    iframe.allow = "clipboard-write";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox");
    iframe.style.cssText = "width:100%;height:100%;border:0;display:block";
    iframe.loading = "lazy";
    iframe.title = "SIGNA room #" + slug;
    // Honour the container's height — fallback to 560px if not set.
    var cs = getComputedStyle(el);
    if (!cs.height || cs.height === "auto" || cs.height === "0px") {
      el.style.height = "560px";
    }
    if (!cs.width || cs.width === "auto" || cs.width === "0px") {
      el.style.width = "100%";
    }
    if (cs.display === "inline") el.style.display = "block";
    el.innerHTML = "";
    el.appendChild(iframe);
    el.setAttribute(MOUNTED, "1");
  }

  function scan() {
    var nodes = document.querySelectorAll("[" + MOUNT_ATTR + "]");
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan);
  } else {
    scan();
  }

  // Re-scan whenever the page mutates so SPAs that inject containers
  // late still get a widget.
  if (typeof MutationObserver !== "undefined") {
    var obs = new MutationObserver(function(muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 1) {
            if (n.hasAttribute && n.hasAttribute(MOUNT_ATTR)) mount(n);
            if (n.querySelectorAll) {
              var inner = n.querySelectorAll("[" + MOUNT_ATTR + "]");
              for (var k = 0; k < inner.length; k++) mount(inner[k]);
            }
          }
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
`;

export function GET(_req: NextRequest) {
  return new NextResponse(SCRIPT, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=3600",
      "access-control-allow-origin": "*",
    },
  });
}
