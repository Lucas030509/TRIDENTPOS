/* ============================================================================
   TRIDENTPOS — UI Preview V4 — Functional Salón Operations Prototype
   PREVIEW_FIXTURE_DATA / PREVIEW_SESSION_STATE / PREVIEW_EVENT_LOG /
   PREVIEW_POLICY_STUBS / PREVIEW_UI_PREFERENCE
   ----------------------------------------------------------------------------
   Built on the V3/V3-R1 visual system (no redesign). Everything here is
   browser-memory state — reload resets the demo. See
   docs/design/TRIDENTPOS_SALON_FUNCTIONAL_PREVIEW_SPEC.md for the full
   classification matrix (CANONICAL_SUPPORTED / PREVIEW_ONLY /
   PROTECTED_DECISION / FUTURE_MODULE / NOT_IMPLEMENTED) and the explicit
   statement that OQ-SSOT-01/02/06/07 remain unresolved by this preview.
   ============================================================================ */

(function () {
  "use strict";

  var TAX_RATE = 0.16;
  var SIDEBAR_PREF_KEY = "tridentpos_preview_sidebar_v1"; // PREVIEW_UI_PREFERENCE
  var INSIGHT_DISMISS_KEY = "tridentpos_preview_dismissed_insights"; // PREVIEW_DISMISSED_INSIGHT (sessionStorage)

  /* ---------------------------------------------------------------------
     FIXTURE DATA — PREVIEW_FIXTURE_DATA — menu (unchanged from V3)
     --------------------------------------------------------------------- */

  var MENU = [
    { id: "p01", cat: "Entradas", name: "Guacamole en Molcajete", price: 165, desc: "Aguacate · limón · chile serrano" },
    { id: "p02", cat: "Entradas", name: "Queso Fundido con Chorizo", price: 155, desc: "Chorizo · tortilla de harina" },
    { id: "p03", cat: "Entradas", name: "Sopa Azteca", price: 120, desc: "Tortilla · pasilla · queso panela" },
    { id: "p04", cat: "Entradas", name: "Tostadas de Atún", price: 175, desc: "Atún sellado · aguacate · soya" },
    { id: "p05", cat: "Entradas", name: "Aguachile Verde", price: 195, desc: "Camarón · limón · chile verde" },
    { id: "p06", cat: "Tacos", name: "Taco Rib Eye", price: 148, desc: "Rib eye · salsa · tortilla" },
    { id: "p07", cat: "Tacos", name: "Taco Al Pastor", price: 42, desc: "Piña · cilantro · cebolla" },
    { id: "p08", cat: "Tacos", name: "Taco de Camarón", price: 68, desc: "Camarón · chipotle · col" },
    { id: "p09", cat: "Tacos", name: "Taco de Cochinita", price: 45, desc: "Cochinita pibil · cebolla morada" },
    { id: "p10", cat: "Tacos", name: "Quesabirria (par)", price: 98, desc: "Birria · consomé · queso" },
    { id: "p11", cat: "Tacos", name: "Taco de Pescado", price: 62, desc: "Pescado capeado · slaw · chipotle" },
    { id: "p12", cat: "Platos", name: "Arrachera a la Parrilla", price: 385, desc: "300g · nopales · guacamole" },
    { id: "p13", cat: "Platos", name: "Mixiote de Res", price: 245, desc: "Chile guajillo · penca de maguey" },
    { id: "p14", cat: "Platos", name: "Costillas BBQ", price: 320, desc: "Salsa BBQ de la casa · papas" },
    { id: "p15", cat: "Platos", name: "Enchiladas Suizas", price: 165, desc: "Pollo · crema · queso gratinado" },
    { id: "p16", cat: "Platos", name: "Pollo a la Parrilla", price: 210, desc: "Hierbas finas · vegetales asados" },
    { id: "p17", cat: "Platos", name: "Filete de Salmón", price: 345, desc: "Costra de ajonjolí · puré" },
    { id: "p18", cat: "Bebidas", name: "Agua Mineral", price: 45, desc: "355 ml" },
    { id: "p19", cat: "Bebidas", name: "Limonada Natural", price: 55, desc: "Limón recién exprimido" },
    { id: "p20", cat: "Bebidas", name: "Michelada", price: 95, desc: "Cerveza · sal de chile · limón" },
    { id: "p21", cat: "Bebidas", name: "Margarita Tamarindo", price: 135, desc: "Tequila · tamarindo · chamoy" },
    { id: "p22", cat: "Bebidas", name: "Cerveza Artesanal", price: 85, desc: "Selección local rotativa" },
    { id: "p23", cat: "Bebidas", name: "Café de Olla", price: 48, desc: "Canela · piloncillo" },
    { id: "p24", cat: "Postres", name: "Cheesecake de Frutos Rojos", price: 95, desc: "Coulis de frutos rojos" },
    { id: "p25", cat: "Postres", name: "Flan Napolitano", price: 75, desc: "Caramelo · vainilla" },
    { id: "p26", cat: "Postres", name: "Churros con Cajeta", price: 85, desc: "Canela · azúcar · cajeta" },
    { id: "p27", cat: "Postres", name: "Pastel de Chocolate", price: 105, desc: "Chocolate 70% · ganache" },
    { id: "p28", cat: "Postres", name: "Nieve de Garrafa", price: 65, desc: "Sabor del día" }
  ];

  var CATEGORIES = ["Entradas", "Tacos", "Platos", "Bebidas", "Postres"];
  var FAVORITE_IDS = ["p06", "p18", "p07", "p24", "p20", "p12"];
  var ZONES = ["Salón Principal", "Terraza", "Barra", "Privado"];

  var MODIFIER_PRODUCTS = {
    p06: {
      groups: [
        { key: "termino", label: "Término", type: "radio", options: [
          { id: "medio", label: "Medio" }, { id: "34", label: "3/4" }, { id: "bien", label: "Bien cocido" }
        ] },
        { key: "extras", label: "Extras", type: "checkbox", kind: "add", options: [
          { id: "aguacate", label: "Aguacate" }, { id: "queso", label: "Queso" }
        ] },
        { key: "quitar", label: "Quitar", type: "checkbox", kind: "remove", options: [{ id: "cebolla", label: "Sin cebolla" }] }
      ]
    }
  };

  /* ---------------------------------------------------------------------
     FIXTURE DATA — roles, permissions, branches, waiters (V4)
     PREVIEW_POLICY_STUBS — not canonical RBAC.
     --------------------------------------------------------------------- */

  var ROLES = {
    gerente: { label: "Gerente", initials: "CM", can: { CAN_DISCOUNT: true, CAN_CANCEL_ACCOUNT: true, CAN_FORCE_RELEASE: true, CAN_CHANGE_WAITER: true, CAN_MOVE_TABLE: true, CAN_EDIT_FLOOR_PLAN: true } },
    cajero: { label: "Cajero", initials: "CM", can: { CAN_DISCOUNT: false, CAN_CANCEL_ACCOUNT: false, CAN_FORCE_RELEASE: false, CAN_CHANGE_WAITER: true, CAN_MOVE_TABLE: true, CAN_EDIT_FLOOR_PLAN: false } },
    mesero: { label: "Mesero", initials: "CM", can: { CAN_DISCOUNT: false, CAN_CANCEL_ACCOUNT: false, CAN_FORCE_RELEASE: false, CAN_CHANGE_WAITER: false, CAN_MOVE_TABLE: true, CAN_EDIT_FLOOR_PLAN: false } }
  };
  var ROLE_ORDER = ["gerente", "cajero", "mesero"];

  var CURRENT_USER = { name: "Carlos Mendoza", roleKey: "gerente" };

  function hasPermission(cap) {
    return !!(ROLES[CURRENT_USER.roleKey] && ROLES[CURRENT_USER.roleKey].can[cap]);
  }

  var BRANCHES = ["Roma Norte", "Condesa", "Polanco"];
  var currentBranch = "Roma Norte";

  var WAITERS = ["Carlos M.", "Ana R.", "Luis P.", "Sofía G.", "Diego H.", "Juan R."];

  /* ---------------------------------------------------------------------
     GENERAL HELPERS (unchanged behavior from V2/V3)
     --------------------------------------------------------------------- */

  function minutesAgo(min) { return Date.now() - min * 60 * 1000; }

  function fmtMoney(n) {
    return "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function elapsedLabel(ts) {
    var min = Math.max(0, Math.round((Date.now() - ts) / 60000));
    return min + " min";
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("visible"); }, 2400);
  }

  var idCounter = 0;
  function nextId(prefix) { idCounter += 1; return prefix + idCounter; }

  /* ---------------------------------------------------------------------
     PREVIEW_EVENT_LOG — browser-memory audit trail only
     --------------------------------------------------------------------- */

  var EVENT_LOG = [];

  function logEvent(entity, entityId, eventType, summary) {
    EVENT_LOG.unshift({
      id: nextId("ev"),
      timestamp: Date.now(),
      actor: CURRENT_USER.name,
      entity: entity,
      entityId: entityId,
      eventType: eventType,
      summary: summary
    });
  }

  /* ---------------------------------------------------------------------
     NOTIFICATIONS — PREVIEW_FIXTURE_DATA, generated by the fixture rule
     engine (manual demo triggers), not a real scheduler.
     --------------------------------------------------------------------- */

  var NOTIFICATIONS = [];

  function pushNotification(type, tableId, severity, summary) {
    NOTIFICATIONS.unshift({
      id: nextId("nt"),
      type: type,
      tableId: tableId || null,
      timestamp: Date.now(),
      severity: severity,
      status: "unread",
      summary: summary
    });
    renderNotifBadge();
  }

  /* ---------------------------------------------------------------------
     TABLE MODEL — TableSessionPreview (work order §7)
     --------------------------------------------------------------------- */

  function tbl(number, zone, capacity, initialStatus, waiter, openedAt, lines, opts) {
    opts = opts || {};
    var t = {
      id: "mesa-" + number,
      number: number,
      zone: zone,
      capacity: capacity,
      waiter: waiter || null,
      customer: opts.customer || null,
      session: null,
      account: null,
      orders: [],
      attention: null,
      checkRequested: false,
      reservation: null,
      x: 0,
      y: 0
    };

    if (initialStatus === "ocupada" || initialStatus === "atencion" || initialStatus === "por_cobrar") {
      t.session = { openedAt: openedAt, guests: opts.guests || capacity };
      t.account = {
        folio: "F-" + String(1000 + number),
        status: initialStatus === "por_cobrar" ? "IMPRESA" : "ABIERTA",
        discount: null,
        lines: (lines || []).map(function (l, i) {
          return {
            id: "l" + number + "-" + i,
            name: l.name,
            qty: l.qty,
            unitPrice: l.unitPrice,
            mods: l.mods || [],
            orderId: "ORD-" + (1000 + number)
          };
        })
      };
      t.orders = t.account.lines.length
        ? [{ id: "ORD-" + (1000 + number), kdsStatus: "SERVIDO", sentAt: openedAt }]
        : [];
      if (initialStatus === "por_cobrar") { t.checkRequested = true; }
      if (initialStatus === "atencion") {
        t.attention = { cause: opts.attentionCause || "MANUAL_INCIDENT", since: minutesAgo(opts.attentionMinutesAgo || 5) };
      }
    }
    return t;
  }

  function lineSubtotal(line) { return line.qty * line.unitPrice; }

  function accountRawSubtotal(account) {
    if (!account) return 0;
    return account.lines.reduce(function (sum, l) { return sum + lineSubtotal(l); }, 0);
  }

  function accountDiscountAmount(account) {
    if (!account || !account.discount) return 0;
    var raw = accountRawSubtotal(account);
    if (account.discount.type === "percent") return raw * (account.discount.value / 100);
    return Math.min(account.discount.value, raw);
  }

  function accountSubtotal(account) {
    return Math.max(0, accountRawSubtotal(account) - accountDiscountAmount(account));
  }

  function accountTotal(account) {
    return accountSubtotal(account) * (1 + TAX_RATE);
  }

  var TABLES = [
    tbl(1, "Salón Principal", 4, "disponible"),
    tbl(2, "Salón Principal", 2, "disponible"),
    tbl(3, "Salón Principal", 4, "ocupada", "Carlos M.", minutesAgo(38), [
      { name: "Taco Rib Eye", qty: 2, unitPrice: 148, mods: [{ t: "remove", label: "Sin cebolla" }, { t: "add", label: "Aguacate" }] },
      { name: "Agua Mineral", qty: 1, unitPrice: 45, mods: [] },
      { name: "Cheesecake de Frutos Rojos", qty: 1, unitPrice: 95, mods: [] }
    ]),
    tbl(4, "Salón Principal", 6, "disponible"),
    tbl(5, "Salón Principal", 4, "ocupada", "Ana R.", minutesAgo(8), [
      { name: "Guacamole en Molcajete", qty: 1, unitPrice: 165, mods: [] },
      { name: "Michelada", qty: 1, unitPrice: 95, mods: [] }
    ]),
    tbl(6, "Salón Principal", 2, "disponible"),
    tbl(7, "Terraza", 2, "ocupada", "Ana R.", minutesAgo(15), [
      { name: "Aguachile Verde", qty: 1, unitPrice: 195, mods: [] },
      { name: "Cerveza Artesanal", qty: 2, unitPrice: 85, mods: [] }
    ]),
    tbl(8, "Terraza", 2, "disponible"),
    tbl(9, "Terraza", 4, "disponible"),
    tbl(10, "Terraza", 4, "disponible"),
    tbl(11, "Terraza", 6, "atencion", "Luis P.", minutesAgo(52), [
      { name: "Arrachera a la Parrilla", qty: 3, unitPrice: 385, mods: [{ t: "add", label: "Término medio" }] },
      { name: "Margarita Tamarindo", qty: 4, unitPrice: 135, mods: [] },
      { name: "Queso Fundido con Chorizo", qty: 2, unitPrice: 155, mods: [] }
    ], { attentionCause: "TABLE_TIME_THRESHOLD", attentionMinutesAgo: 12 }),
    tbl(12, "Terraza", 4, "disponible"),
    tbl(13, "Barra", 2, "disponible"),
    tbl(14, "Barra", 2, "por_cobrar", "Sofía G.", minutesAgo(64), [
      { name: "Taco Al Pastor", qty: 6, unitPrice: 42, mods: [] },
      { name: "Cerveza Artesanal", qty: 3, unitPrice: 85, mods: [] }
    ]),
    tbl(15, "Barra", 2, "disponible"),
    tbl(16, "Barra", 4, "disponible"),
    tbl(17, "Privado", 8, "disponible"),
    tbl(18, "Privado", 8, "ocupada", "Diego H.", minutesAgo(22), [
      { name: "Filete de Salmón", qty: 4, unitPrice: 345, mods: [] },
      { name: "Costillas BBQ", qty: 3, unitPrice: 320, mods: [{ t: "remove", label: "Sin salsa BBQ" }] },
      { name: "Margarita Tamarindo", qty: 6, unitPrice: 135, mods: [] },
      { name: "Pastel de Chocolate", qty: 4, unitPrice: 105, mods: [] }
    ]),
    tbl(19, "Privado", 6, "disponible"),
    tbl(20, "Privado", 10, "disponible")
  ];

  function findTable(id) {
    for (var i = 0; i < TABLES.length; i++) { if (TABLES[i].id === id) return TABLES[i]; }
    return null;
  }

  // Fixture reservations (PREVIEW_ONLY — no canonical reservation aggregate).
  findTable("mesa-2").reservation = { hora: "14:30", cliente: "Fernanda Ruiz", personas: 4, toleranceExceeded: false };
  findTable("mesa-15").reservation = { hora: "13:00", cliente: "Grupo Herrera", personas: 6, toleranceExceeded: true };

  function assignFloorCoordinates() {
    var origins = { "Salón Principal": [20, 20], "Terraza": [520, 20], "Barra": [20, 320], "Privado": [520, 320] };
    var counters = {};
    TABLES.forEach(function (t) {
      var idx = counters[t.zone] || 0;
      counters[t.zone] = idx + 1;
      var col = idx % 4, row = Math.floor(idx / 4);
      var origin = origins[t.zone] || [20, 20];
      t.x = origin[0] + col * 110;
      t.y = origin[1] + row * 100;
    });
  }
  assignFloorCoordinates();

  /* ---------------------------------------------------------------------
     ARCHITECTURAL RULE (work order §54) — VisualTableState is NEVER a
     stored field. It is projected on every render from the underlying
     preview-domain-like fields below. Attention is always an overlay.
     --------------------------------------------------------------------- */

  function underlyingVisualState(t) {
    if (!t.session) return "disponible";
    if (t.account && (t.account.status === "IMPRESA" || t.checkRequested)) return "por_cobrar";
    return "ocupada";
  }

  function computeVisualState(t) {
    if (t.reservation && !t.session) return "reservada";
    if (!t.session) return "disponible";
    if (t.attention) return "atencion";
    return underlyingVisualState(t);
  }

  function statusLabel(status) {
    return { disponible: "Disponible", ocupada: "Ocupada", atencion: "Atención", por_cobrar: "Por cobrar", reservada: "Reservada" }[status] || status;
  }

  function statusIcon(status) {
    switch (status) {
      case "disponible": return '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
      case "ocupada": return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
      case "atencion": return '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a1.5 1.5 0 0 0 1.3 2.3h17.8a1.5 1.5 0 0 0 1.3-2.3L13.7 3.9a1.5 1.5 0 0 0-2.6 0Z"/></svg>';
      case "por_cobrar": return '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';
      case "reservada": return '<svg viewBox="0 0 24 24"><path d="M8 7V3m8 4V3M4 11h16M5 7h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/></svg>';
      default: return "";
    }
  }

  var ATTENTION_CAUSE_LABEL = {
    TABLE_TIME_THRESHOLD: "La mesa superó el tiempo máximo configurado sin actividad.",
    KDS_DELAY: "El pedido lleva más tiempo del esperado en cocina.",
    CUSTOMER_CALL: "El cliente solicitó la atención de un mesero.",
    KITCHEN_REJECTION: "Cocina rechazó un producto de la comanda.",
    PRODUCT_UNAVAILABLE: "Un producto de la orden ya no está disponible.",
    MANUAL_INCIDENT: "Incidencia registrada manualmente por el personal."
  };

  /* ---------------------------------------------------------------------
     APP STATE (screen-level, not domain — everything above is the
     PREVIEW_SESSION_STATE "domain-like" layer this projects from)
     --------------------------------------------------------------------- */

  var state = {
    zone: "todos",
    statusFilter: null,
    onlyMine: false,
    showReservations: true,
    sortMode: "numero",
    viewMode: "cards",
    floorConfigMode: false,
    activeTableId: null,
    posCategory: "Favoritos",
    posSearch: "",
    posTicket: [],
    modifier: null,
    payment: null,
    splitBuckets: null
  };

  var lineIdCounter = 0;
  function nextLineId() { lineIdCounter += 1; return "tl" + lineIdCounter; }

  /* ---------------------------------------------------------------------
     GENERIC DROPDOWN / POPOVER SYSTEM — one open at a time.
     --------------------------------------------------------------------- */

  var openDropdownEl = null;

  function closeAllDropdowns() {
    if (openDropdownEl) { openDropdownEl.hidden = true; openDropdownEl = null; }
  }

  function toggleDropdown(panelEl, buildHtml) {
    if (openDropdownEl === panelEl && !panelEl.hidden) { closeAllDropdowns(); return; }
    closeAllDropdowns();
    panelEl.innerHTML = buildHtml();
    panelEl.hidden = false;
    openDropdownEl = panelEl;
    bindDropdownActions(panelEl);
  }

  function refreshDropdown(panelEl, buildHtml) {
    if (openDropdownEl !== panelEl || panelEl.hidden) return;
    panelEl.innerHTML = buildHtml();
    bindDropdownActions(panelEl);
  }

  function bindDropdownActions(panelEl) {
    Array.prototype.forEach.call(panelEl.querySelectorAll("[data-action]"), function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var action = btn.getAttribute("data-action");
        var arg = btn.getAttribute("data-arg");
        dispatchDropdownAction(action, arg, btn);
      });
    });
  }

  document.addEventListener("click", function (e) {
    if (openDropdownEl && !openDropdownEl.contains(e.target)) {
      var anchor = openDropdownEl.previousElementSibling;
      if (!anchor || !anchor.contains(e.target)) closeAllDropdowns();
    }
  });

  /* ---------------------------------------------------------------------
     GENERIC MODAL SYSTEM — reused by every V4 functional flow.
     --------------------------------------------------------------------- */

  function openModal(opts) {
    document.getElementById("generic-modal-eyebrow").textContent = opts.eyebrow || "Acción";
    document.getElementById("generic-modal-title").textContent = opts.title || "";
    document.getElementById("generic-modal-body").innerHTML = opts.bodyHtml || "";
    document.getElementById("generic-modal-footer").innerHTML = opts.footerHtml || "";
    document.getElementById("generic-modal").classList.toggle("modal-wide", !!opts.wide);
    document.getElementById("generic-modal-backdrop").classList.add("visible");
    document.getElementById("generic-modal").classList.add("open");
    bindDropdownActions(document.getElementById("generic-modal-body"));
    bindDropdownActions(document.getElementById("generic-modal-footer"));
    if (opts.onMount) opts.onMount();
  }

  function closeModal() {
    document.getElementById("generic-modal-backdrop").classList.remove("visible");
    document.getElementById("generic-modal").classList.remove("open");
    state.payment = null;
    state.splitBuckets = null;
  }

  function isModalOpen() {
    return document.getElementById("generic-modal").classList.contains("open");
  }

  /* ---------------------------------------------------------------------
     SIDEBAR — expand / collapse — PREVIEW_UI_PREFERENCE (unchanged from V2/V3)
     --------------------------------------------------------------------- */

  function readSidebarPreference() {
    try { return window.localStorage.getItem(SIDEBAR_PREF_KEY); } catch (e) { return null; }
  }
  function writeSidebarPreference(value) {
    try { window.localStorage.setItem(SIDEBAR_PREF_KEY, value); } catch (e) {}
  }
  function applySidebarState(collapsed) {
    var sidebar = document.getElementById("sidebar");
    sidebar.classList.toggle("collapsed", collapsed);
    var toggleBtn = document.getElementById("sidebar-toggle");
    toggleBtn.setAttribute("data-tooltip", collapsed ? "Expandir" : "Colapsar");
    toggleBtn.querySelector(".nav-label").textContent = collapsed ? "Expandir" : "Colapsar";
  }
  function initSidebar() {
    var stored = readSidebarPreference();
    var collapsed = (stored === "collapsed" || stored === "expanded") ? stored === "collapsed" : window.innerWidth <= 1280;
    applySidebarState(collapsed);
    document.getElementById("sidebar-toggle").addEventListener("click", function () {
      var next = !document.getElementById("sidebar").classList.contains("collapsed");
      applySidebarState(next);
      writeSidebarPreference(next ? "collapsed" : "expanded");
    });
  }

  /* ---------------------------------------------------------------------
     TOPBAR — branch selector, search, demo panel, notifications, user menu
     --------------------------------------------------------------------- */

  function renderBranchLabel() {
    document.getElementById("branch-selector-label").textContent = "Sucursal " + currentBranch;
  }

  function hasOpenContext() {
    return !!state.activeTableId || document.getElementById("account-panel").classList.contains("open") ||
      document.getElementById("view-pos").classList.contains("active");
  }

  function buildBranchDropdownHtml() {
    return BRANCHES.map(function (b) {
      var active = b === currentBranch;
      return '<button class="dropdown-item' + (active ? " disabled" : "") + '"' +
        (active ? " disabled" : ' data-action="switch-branch" data-arg="' + escapeHtml(b) + '"') + '>' +
        (active ? '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>' : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>') +
        "Sucursal " + escapeHtml(b) + "</button>";
    }).join("");
  }

  function switchBranch(name) {
    currentBranch = name;
    renderBranchLabel();
    toast("Cambiando a sucursal " + name + "...");
    closeAccountPanel();
    exitPosMode(false);
    resetFixtureState();
    switchView("salon");
  }

  function resetFixtureState() {
    EVENT_LOG.length = 0;
    NOTIFICATIONS.length = 0;
    state.activeTableId = null;
    state.statusFilter = null;
    state.zone = "todos";
    renderTablesGrid();
    renderNotifBadge();
  }

  function requestBranchSwitch(name) {
    closeAllDropdowns();
    if (name === currentBranch) return;
    if (hasOpenContext()) {
      openModal({
        eyebrow: "Confirmar",
        title: "Cambiar de sucursal",
        bodyHtml: '<p style="font-size:14px;color:var(--text-secondary);">Cambiar de sucursal cerrará el contexto actual.</p>',
        footerHtml:
          '<button class="btn-secondary" data-action="close-modal">Cancelar</button>' +
          '<button class="btn-primary" data-action="confirm-branch-switch" data-arg="' + escapeHtml(name) + '">Cambiar sucursal</button>'
      });
    } else {
      switchBranch(name);
    }
  }

  function buildUserMenuHtml() {
    return (
      '<button class="dropdown-item" data-action="toast-only" data-arg="Mi perfil — vista previa, sin backend"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>Mi perfil</button>' +
      '<button class="dropdown-item" data-action="change-shift"><svg viewBox="0 0 24 24"><path d="M4 4v6h6M20 20v-6h-6"/><path d="M20 10a8 8 0 0 0-14.6-4.7M4 14a8 8 0 0 0 14.6 4.7"/></svg>Cambiar turno (rol: ' + ROLES[CURRENT_USER.roleKey].label + ")</button>" +
      '<button class="dropdown-item" data-action="open-branch-from-user"><svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg>Cambiar sucursal</button>' +
      '<button class="dropdown-item" data-action="toast-only" data-arg="Terminal bloqueada (PREVIEW) — sin lógica real de bloqueo"><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Bloquear terminal</button>' +
      '<div class="dropdown-sep"></div>' +
      '<button class="dropdown-item danger" data-action="toast-only" data-arg="Cerrar sesión — vista previa, sin backend"><svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>Cerrar sesión</button>'
    );
  }

  function changeShift() {
    var idx = ROLE_ORDER.indexOf(CURRENT_USER.roleKey);
    CURRENT_USER.roleKey = ROLE_ORDER[(idx + 1) % ROLE_ORDER.length];
    renderUserChip();
    closeAllDropdowns();
    toast("Turno cambiado — rol activo: " + ROLES[CURRENT_USER.roleKey].label);
  }

  function renderUserChip() {
    var role = ROLES[CURRENT_USER.roleKey];
    document.getElementById("user-menu-role").textContent = role.label;
    document.getElementById("user-menu-name").textContent = CURRENT_USER.name;
  }

  function initTopbar() {
    renderBranchLabel();
    renderUserChip();

    document.getElementById("branch-selector").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleDropdown(document.getElementById("branch-dropdown"), buildBranchDropdownHtml);
    });
    document.getElementById("user-menu-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleDropdown(document.getElementById("user-menu-dropdown"), buildUserMenuHtml);
    });
    document.getElementById("btn-notifications").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleDropdown(document.getElementById("notif-panel"), buildNotifPanelHtml);
    });
    document.getElementById("btn-demo-panel").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleDropdown(document.getElementById("demo-panel"), buildDemoPanelHtml);
    });
    document.getElementById("btn-global-search").addEventListener("click", openSearch);
  }

  /* ---------------------------------------------------------------------
     NOTIFICATIONS PANEL
     --------------------------------------------------------------------- */

  function renderNotifBadge() {
    var unread = NOTIFICATIONS.filter(function (n) { return n.status === "unread"; }).length;
    var badge = document.getElementById("notif-badge");
    badge.textContent = unread;
    badge.hidden = unread === 0;
  }

  var NOTIF_ICON = { attention: "!", check: "$", stock: "%" };

  function buildNotifPanelHtml() {
    if (NOTIFICATIONS.length === 0) {
      return '<div class="notif-empty">Sin notificaciones por el momento.</div>';
    }
    return NOTIFICATIONS.map(function (n) {
      var t = n.tableId ? findTable(n.tableId) : null;
      var title = t ? "Mesa " + pad2(t.number) : "Operación";
      return (
        '<div class="notif-item' + (n.status === "unread" ? " unread" : "") + '">' +
        '<span class="notif-icon severity-' + n.severity + '">' + (NOTIF_ICON[n.type] || "!") + "</span>" +
        '<button class="dropdown-item" style="padding:0;min-height:0;flex:1;align-items:flex-start;flex-direction:column;" data-action="open-notification" data-arg="' + n.id + '">' +
        '<span class="notif-body"><span class="notif-title">' + escapeHtml(title) + '</span><br><span class="notif-sub">' + escapeHtml(n.summary) + '</span><div class="notif-time">' + elapsedLabel(n.timestamp) + " atrás</div></span>" +
        "</button>" +
        (n.status === "unread"
          ? '<button class="notif-mark-read" title="Marcar como leída" data-action="mark-notif-read" data-arg="' + n.id + '"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></button>'
          : "") +
        "</div>"
      );
    }).join("");
  }

  function openNotificationEntry(id) {
    var n = NOTIFICATIONS.find(function (x) { return x.id === id; });
    if (!n) return;
    closeAllDropdowns();
    if (n.tableId) {
      switchView("salon");
      openAccountPanel(n.tableId);
    }
  }

  function markNotifRead(id) {
    var n = NOTIFICATIONS.find(function (x) { return x.id === id; });
    if (n) n.status = "read";
    renderNotifBadge();
    refreshDropdown(document.getElementById("notif-panel"), buildNotifPanelHtml);
  }

  /* ---------------------------------------------------------------------
     DEMO / ALERT SIMULATOR PANEL (work order §47) — explicit dev/PO tool.
     --------------------------------------------------------------------- */

  function triggerAttention(t, cause) {
    t.attention = { cause: cause, since: Date.now() };
    logEvent("mesa", t.id, "ATTENTION_TRIGGERED", "Atención activada (" + cause + ") en Mesa " + pad2(t.number));
    pushNotification("attention", t.id, cause === "CUSTOMER_CALL" ? "warning" : "critical",
      "Mesa " + pad2(t.number) + " requiere atención — " + ATTENTION_CAUSE_LABEL[cause]);
    renderTablesGrid();
    renderFloorPlan();
    if (state.activeTableId === t.id) renderAccountPanel();
  }

  function randomOccupiedTable() {
    var candidates = TABLES.filter(function (t) { return t.session && !t.attention; });
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function buildDemoPanelHtml() {
    var active = state.activeTableId ? findTable(state.activeTableId) : null;
    var activeLabel = active ? "Mesa " + pad2(active.number) : "(ninguna mesa abierta)";
    var lastOrder = active && active.orders.length ? active.orders[active.orders.length - 1] : null;
    return (
      '<span class="demo-panel-tag">SIMULADOR — PREVIEW</span>' +
      '<div class="demo-panel-section">' +
      '<div class="dropdown-heading">Mesa activa: ' + escapeHtml(activeLabel) + "</div>" +
      '<button class="dropdown-item"' + (active ? "" : " disabled") + ' data-action="demo-attention-active" data-arg="CUSTOMER_CALL">Cliente llama al mesero</button>' +
      '<button class="dropdown-item"' + (active ? "" : " disabled") + ' data-action="demo-attention-active" data-arg="PRODUCT_UNAVAILABLE">Producto agotado en el pedido</button>' +
      '<button class="dropdown-item"' + (active && lastOrder ? "" : " disabled") + ' data-action="demo-advance-kds">Avanzar preparación (' + (lastOrder ? kdsStatusLabel(lastOrder.kdsStatus) : "—") + ")</button>" +
      "</div>" +
      '<div class="demo-panel-section">' +
      '<div class="dropdown-heading">General</div>' +
      '<button class="dropdown-item" data-action="demo-random-attention" data-arg="TABLE_TIME_THRESHOLD">Mesa con tiempo excedido (aleatoria)</button>' +
      '<button class="dropdown-item" data-action="demo-random-attention" data-arg="KDS_DELAY">Pedido retrasado en KDS (aleatoria)</button>' +
      '<button class="dropdown-item" data-action="demo-random-checkrequest">Cliente solicita cuenta (aleatoria)</button>' +
      '<button class="dropdown-item" data-action="demo-stock-alert">Producto agotado (stock)</button>' +
      '<button class="dropdown-item" data-action="demo-lowstock-alert">Stock bajo</button>' +
      "</div>"
    );
  }

  function kdsStatusLabel(s) {
    return { ENVIADO: "Enviado", PREPARACION: "En preparación", LISTO: "Listo", SERVIDO: "Servido" }[s] || s;
  }

  function advanceKdsForActiveTable() {
    var t = state.activeTableId ? findTable(state.activeTableId) : null;
    if (!t || !t.orders.length) return;
    var order = t.orders[t.orders.length - 1];
    var sequence = ["ENVIADO", "PREPARACION", "LISTO", "SERVIDO"];
    var idx = sequence.indexOf(order.kdsStatus);
    if (idx < sequence.length - 1) order.kdsStatus = sequence[idx + 1];
    toast("Pedido " + order.id + " → " + kdsStatusLabel(order.kdsStatus));
    if (state.activeTableId === t.id) renderAccountPanel();
    refreshDropdown(document.getElementById("demo-panel"), buildDemoPanelHtml);
  }

  /* ---------------------------------------------------------------------
     GLOBAL SEARCH (Cmd/Ctrl+K)
     --------------------------------------------------------------------- */

  function buildSearchIndex() {
    var idx = { Mesas: [], Cuentas: [], Pedidos: [], Clientes: [] };
    TABLES.forEach(function (t) {
      idx.Mesas.push({ label: "Mesa " + pad2(t.number), sub: statusLabel(computeVisualState(t)) + (t.waiter ? " · " + t.waiter : ""), tableId: t.id });
      if (t.account) idx.Cuentas.push({ label: "Cuenta " + t.account.folio, sub: "Mesa " + pad2(t.number) + " · " + fmtMoney(accountTotal(t.account)), tableId: t.id });
      t.orders.forEach(function (o) {
        idx.Pedidos.push({ label: "Pedido " + o.id, sub: "Mesa " + pad2(t.number) + " · " + kdsStatusLabel(o.kdsStatus), tableId: t.id });
      });
      if (t.customer) idx.Clientes.push({ label: t.customer, sub: "Mesa " + pad2(t.number), tableId: t.id });
      if (t.reservation) idx.Clientes.push({ label: t.reservation.cliente, sub: "Reservación · Mesa " + pad2(t.number), tableId: t.id });
    });
    return idx;
  }

  function renderSearchResults(query) {
    var idx = buildSearchIndex();
    var q = query.trim().toLowerCase();
    var groups = ["Mesas", "Cuentas", "Pedidos", "Clientes"];
    var html = "";
    var any = false;
    groups.forEach(function (g) {
      var items = idx[g].filter(function (it) {
        return !q || it.label.toLowerCase().indexOf(q) !== -1 || it.sub.toLowerCase().indexOf(q) !== -1;
      });
      if (!items.length) return;
      any = true;
      html += '<div class="search-group-label">' + g + "</div>";
      items.forEach(function (it) {
        html += '<button class="search-result-item" data-action="search-select" data-arg="' + it.tableId + '">' +
          '<div><div class="search-result-title">' + escapeHtml(it.label) + '</div><div class="search-result-sub">' + escapeHtml(it.sub) + "</div></div></button>";
      });
    });
    document.getElementById("search-overlay-results").innerHTML = any ? html : '<div class="search-empty">Sin resultados para tu búsqueda.</div>';
    bindDropdownActions(document.getElementById("search-overlay-results"));
  }

  function openSearch() {
    closeAllDropdowns();
    document.getElementById("search-backdrop").classList.add("visible");
    document.getElementById("search-overlay").classList.add("open");
    var input = document.getElementById("global-search-input");
    input.value = "";
    renderSearchResults("");
    setTimeout(function () { input.focus(); }, 30);
  }

  function closeSearch() {
    document.getElementById("search-backdrop").classList.remove("visible");
    document.getElementById("search-overlay").classList.remove("open");
  }

  function isSearchOpen() {
    return document.getElementById("search-overlay").classList.contains("open");
  }

  /* ---------------------------------------------------------------------
     INSIGHT BANNER (§48) — sessionStorage-only dismissal, fixture text.
     --------------------------------------------------------------------- */

  var INSIGHTS = [
    "Mesa 11 lleva 40% más tiempo que el promedio.",
    "Las mesas 03, 07 y 18 presentan mayor rotación.",
    "3 productos están retrasando cocina."
  ];

  function readDismissedInsights() {
    try { return JSON.parse(window.sessionStorage.getItem(INSIGHT_DISMISS_KEY) || "[]"); } catch (e) { return []; }
  }
  function writeDismissedInsights(list) {
    try { window.sessionStorage.setItem(INSIGHT_DISMISS_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function renderInsightBanner() {
    var dismissed = readDismissedInsights();
    var next = INSIGHTS.find(function (msg) { return dismissed.indexOf(msg) === -1; });
    var banner = document.getElementById("insight-banner");
    if (!next) { banner.hidden = true; return; }
    document.getElementById("insight-banner-text").textContent = next;
    banner.hidden = false;
    banner.dataset.current = next;
  }

  function dismissCurrentInsight() {
    var banner = document.getElementById("insight-banner");
    var current = banner.dataset.current;
    if (!current) return;
    var dismissed = readDismissedInsights();
    dismissed.push(current);
    writeDismissedInsights(dismissed);
    renderInsightBanner();
  }

  /* ---------------------------------------------------------------------
     KPI FILTER ROW (§15) + AREA FILTER (§14) — combinable.
     --------------------------------------------------------------------- */

  var KPI_DEFS = [
    { key: "disponible", label: "Disponibles" },
    { key: "ocupada", label: "Ocupadas" },
    { key: "atencion", label: "En atención" },
    { key: "por_cobrar", label: "Por cobrar" },
    { key: "reservada", label: "Reservadas" }
  ];

  function statusCounts() {
    var counts = { disponible: 0, ocupada: 0, atencion: 0, por_cobrar: 0, reservada: 0 };
    TABLES.forEach(function (t) { counts[computeVisualState(t)]++; });
    return counts;
  }

  function renderKpiRow() {
    var counts = statusCounts();
    var html = KPI_DEFS.map(function (k) {
      var active = state.statusFilter === k.key;
      return '<button class="kpi-filter-pill' + (active ? " active" : "") + '" data-action="filter-status" data-arg="' + k.key + '">' +
        '<span class="kpi-filter-count">' + counts[k.key] + '</span><span>' + k.label + "</span></button>";
    }).join("");
    var anyFilter = state.statusFilter || state.zone !== "todos" || state.onlyMine;
    if (anyFilter) html += '<button class="kpi-filter-reset" data-action="reset-filters">Limpiar filtros ×</button>';
    var row = document.getElementById("kpi-filter-row");
    row.innerHTML = html;
    bindDropdownActions(row);
  }

  /* ---------------------------------------------------------------------
     SALÓN GLOBAL MENU (§18, the "..." menu of the whole view)
     --------------------------------------------------------------------- */

  function buildSalonMenuHtml() {
    return (
      '<div class="dropdown-heading">Ordenar mesas</div>' +
      dropdownCheckItem("Número", state.sortMode === "numero", "sort-mode", "numero") +
      dropdownCheckItem("Estado", state.sortMode === "estado", "sort-mode", "estado") +
      dropdownCheckItem("Tiempo de espera", state.sortMode === "tiempo", "sort-mode", "tiempo") +
      '<div class="dropdown-sep"></div>' +
      dropdownCheckItem("Mostrar solo mis mesas", state.onlyMine, "toggle-only-mine", "") +
      dropdownCheckItem("Mostrar reservaciones", state.showReservations, "toggle-show-reservations", "") +
      '<div class="dropdown-sep"></div>' +
      '<button class="dropdown-item" data-action="fullscreen-toggle"><svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m11-5v3a2 2 0 0 1-2 2h-3"/></svg>Modo pantalla completa</button>' +
      '<button class="dropdown-item" data-action="configure-salon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M3 12h4m10 0h4M12 3v4m0 10v4"/></svg>Configurar salón</button>' +
      '<button class="dropdown-item" data-action="print-floor-map"><svg viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/></svg>Imprimir mapa de mesas</button>'
    );
  }

  function dropdownCheckItem(label, checked, action, arg) {
    return '<button class="dropdown-checkitem' + (checked ? " checked" : "") + '" data-action="' + action + '" data-arg="' + arg + '">' +
      "<span>" + escapeHtml(label) + '</span><span class="dropdown-check"></span></button>';
  }

  /* ---------------------------------------------------------------------
     RENDER: SALÓN / TABLES GRID (Vista tarjetas)
     --------------------------------------------------------------------- */

  function visibleTables() {
    return TABLES.filter(function (t) {
      if (state.zone !== "todos" && t.zone !== state.zone) return false;
      if (state.onlyMine && t.waiter !== CURRENT_USER.name) return false;
      var vs = computeVisualState(t);
      if (vs === "reservada" && !state.showReservations) return false;
      if (state.statusFilter && vs !== state.statusFilter) return false;
      return true;
    }).sort(function (a, b) {
      if (state.sortMode === "estado") return computeVisualState(a).localeCompare(computeVisualState(b));
      if (state.sortMode === "tiempo") {
        var ta = a.session ? a.session.openedAt : Infinity;
        var tb = b.session ? b.session.openedAt : Infinity;
        return ta - tb;
      }
      return a.number - b.number;
    });
  }

  function renderTablesGrid() {
    renderKpiRow();
    var grid = document.getElementById("tables-grid");
    var visible = visibleTables();

    grid.innerHTML = visible.map(renderTableCard).join("");

    var openCount = TABLES.filter(function (t) { return t.session; }).length;
    document.getElementById("salon-subtitle").textContent = TABLES.length + " mesas · " + openCount + " cuentas abiertas";

    Array.prototype.forEach.call(grid.querySelectorAll(".table-card"), function (card) {
      card.addEventListener("click", function () { openTableFlow(card.getAttribute("data-table-id")); });
    });
    Array.prototype.forEach.call(grid.querySelectorAll(".table-card-menu-btn"), function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        openTableCardMenu(btn, btn.getAttribute("data-table-id"));
      });
    });

    renderFloorPlan();
  }

  function renderTableCard(t) {
    var vs = computeVisualState(t);
    var selected = t.id === state.activeTableId ? " selected" : "";
    var top, mid, bottom;

    if (vs === "disponible") {
      top = "";
      mid = '<div class="table-available-label">Lista para recibir</div>';
      bottom = "";
    } else if (vs === "reservada") {
      var r = t.reservation;
      mid = '<div class="table-waiter">' + escapeHtml(r.cliente) + '</div><div class="table-time">' +
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>' + r.hora + " · " + r.personas + " personas</div>";
      bottom = r.toleranceExceeded
        ? '<div class="table-card-bottom"><span class="table-attention-flag">' + statusIcon("atencion") + "Tolerancia vencida</span></div>"
        : "";
    } else {
      var mins = Math.max(0, Math.round((Date.now() - t.session.openedAt) / 60000));
      var timeClass = mins >= 60 ? " time-critical" : mins >= 45 ? " time-warn" : "";
      mid = '<div class="table-waiter">' + escapeHtml(t.waiter) + '</div><div class="table-time' + timeClass + '">' +
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>' + elapsedLabel(t.session.openedAt) + "</div>";
      var total = accountTotal(t.account);
      var flag = vs === "atencion" ? '<span class="table-attention-flag">' + statusIcon("atencion") + "Requiere atención</span>" : "";
      bottom = '<div class="table-card-bottom"><span class="table-total">' + fmtMoney(total) + "</span>" + flag + "</div>";
    }

    return (
      '<button class="table-card status-' + vs + selected + '" data-table-id="' + t.id + '">' +
      '<div class="table-card-top"><div><div class="table-number">Mesa ' + pad2(t.number) +
      '</div><div class="table-capacity"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>' + t.capacity + " personas</div></div>" +
      '<div class="table-card-top-right">' +
      '<span class="status-badge status-' + vs + '">' + statusIcon(vs) + statusLabel(vs) + "</span>" +
      '<span class="table-card-menu-btn" role="button" tabindex="0" data-table-id="' + t.id + '"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg></span>' +
      "</div></div>" +
      '<div class="table-card-mid">' + mid + "</div>" + bottom + "</button>"
    );
  }

  /* ---------------------------------------------------------------------
     TABLE SECONDARY MENU (per-card "..." — §29)
     --------------------------------------------------------------------- */

  function openTableCardMenu(anchorBtn, tableId) {
    var panel = document.getElementById("table-card-menu");
    var rect = anchorBtn.getBoundingClientRect();
    panel.style.position = "fixed";
    panel.style.top = (rect.bottom + 6) + "px";
    panel.style.left = Math.min(rect.left, window.innerWidth - 260) + "px";
    if (openDropdownEl === panel && !panel.hidden && panel.dataset.tableId === tableId) { closeAllDropdowns(); return; }
    closeAllDropdowns();
    panel.dataset.tableId = tableId;
    panel.innerHTML = buildTableSecondaryMenuHtml(tableId);
    panel.hidden = false;
    openDropdownEl = panel;
    bindDropdownActions(panel);
  }

  function buildTableSecondaryMenuHtml(tableId) {
    var t = findTable(tableId);
    var vs = computeVisualState(t);
    var hasAccount = !!t.account;
    function item(label, action, icon, extraDisabled) {
      return '<button class="dropdown-item' + (extraDisabled ? " disabled" : "") + '"' + (extraDisabled ? " disabled" : "") +
        ' data-action="' + action + '" data-arg="' + tableId + '">' + icon + escapeHtml(label) + "</button>";
    }
    if (vs === "reservada") {
      return item("Sentar reservación", "table-menu-seat", iconArrow());
    }
    if (vs === "disponible") {
      return item("Abrir mesa", "table-menu-open", iconPlus());
    }
    return (
      item("Cambiar mesero", "table-menu-waiter", iconUser(), !hasPermission("CAN_CHANGE_WAITER")) +
      item("Cambiar personas", "table-menu-guests", iconUser()) +
      item("Mover mesa", "table-menu-move", iconMove(), !hasPermission("CAN_MOVE_TABLE")) +
      item("Unir mesas", "table-menu-merge", iconMove()) +
      item("Dividir mesa", "table-menu-split", iconSplit()) +
      item("Imprimir precuenta", "table-menu-precheck", iconPrint()) +
      item("Ver historial", "table-menu-history", iconHistory()) +
      '<div class="dropdown-sep"></div>' +
      item("Aplicar descuento", "table-menu-discount", iconDiscount()) +
      item("Cancelar cuenta", "table-menu-cancel", iconCancel()) +
      item("Liberar mesa", "table-menu-release", iconCancel()) +
      (hasAccount ? "" : "")
    );
  }

  function iconArrow() { return '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7"/></svg>'; }
  function iconPlus() { return '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'; }
  function iconUser() { return '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>'; }
  function iconMove() { return '<svg viewBox="0 0 24 24"><path d="M7 7 3 12l4 5M17 7l4 5-4 5M3 12h18"/></svg>'; }
  function iconSplit() { return '<svg viewBox="0 0 24 24"><path d="M12 3v18M5 8h4M15 8h4M5 16h4M15 16h4"/></svg>'; }
  function iconPrint() { return '<svg viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/></svg>'; }
  function iconHistory() { return '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/><path d="M12 8v4l3 3"/></svg>'; }
  function iconDiscount() { return '<svg viewBox="0 0 24 24"><path d="M4 12 12 4l8 8-8 8-8-8Z"/><circle cx="9.5" cy="9.5" r="1"/></svg>'; }
  function iconCancel() { return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>'; }

  /* ---------------------------------------------------------------------
     FLOOR PLAN VIEW (§17)
     --------------------------------------------------------------------- */

  function renderFloorPlan() {
    var container = document.getElementById("floor-plan");
    container.classList.toggle("config-mode", state.floorConfigMode);
    var visible = visibleTables();
    var hint = state.floorConfigMode
      ? '<div class="floor-plan-hint">Modo configuración activo — arrastra las mesas para reacomodarlas (solo en esta sesión)</div>'
      : "";
    container.innerHTML = hint + '<div class="floor-plan-canvas" id="floor-plan-canvas">' +
      visible.map(function (t) {
        var vs = computeVisualState(t);
        var selected = t.id === state.activeTableId ? " selected" : "";
        return '<div class="floor-table status-' + vs + selected + '" data-table-id="' + t.id + '" style="left:' + t.x + 'px;top:' + t.y + 'px;">' +
          "Mesa " + pad2(t.number) + '<span class="floor-table-sub">' + statusLabel(vs) + "</span></div>";
      }).join("") + "</div>";

    Array.prototype.forEach.call(container.querySelectorAll(".floor-table"), function (el) {
      var tableId = el.getAttribute("data-table-id");
      var dragging = false, startX, startY, origX, origY, moved = false;

      el.addEventListener("pointerdown", function (e) {
        if (!state.floorConfigMode) return;
        if (!hasPermission("CAN_EDIT_FLOOR_PLAN")) { toast("Tu rol no puede editar el plano (PREVIEW_POLICY_STUBS)"); return; }
        dragging = true; moved = false;
        startX = e.clientX; startY = e.clientY;
        var t = findTable(tableId);
        origX = t.x; origY = t.y;
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        moved = true;
        var t = findTable(tableId);
        t.x = Math.max(0, origX + (e.clientX - startX));
        t.y = Math.max(0, origY + (e.clientY - startY));
        el.style.left = t.x + "px";
        el.style.top = t.y + "px";
      });
      el.addEventListener("pointerup", function () {
        dragging = false;
        if (moved) logEvent("mesa", tableId, "TABLE_MOVED", "Posición de Mesa " + pad2(findTable(tableId).number) + " actualizada en el plano (PREVIEW, solo layout)");
      });
      el.addEventListener("click", function () {
        if (state.floorConfigMode || moved) return;
        openTableFlow(tableId);
      });
    });
  }

  function setViewMode(mode) {
    state.viewMode = mode;
    Array.prototype.forEach.call(document.querySelectorAll(".view-toggle-btn"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-view-mode") === mode);
    });
    document.getElementById("tables-grid").hidden = mode !== "cards";
    document.getElementById("floor-plan").hidden = mode !== "floor";
    renderFloorPlan();
  }

  /* ---------------------------------------------------------------------
     PRIMARY ACTION DISPATCH (work order §16/§50 — whole card = primary
     action, routed by the table's current projected visual state)
     --------------------------------------------------------------------- */

  function openTableFlow(tableId) {
    var t = findTable(tableId);
    if (!t) return;
    var vs = computeVisualState(t);
    if (vs === "disponible") { openOpenTableModal(t); return; }
    if (vs === "reservada") { openReservationModal(t); return; }
    openAccountPanel(tableId);
  }

  /* ---------------------------------------------------------------------
     OPEN TABLE (§20)
     --------------------------------------------------------------------- */

  function openOpenTableModal(t) {
    var waiterOptions = WAITERS.map(function (w) { return '<option value="' + escapeHtml(w) + '">' + escapeHtml(w) + "</option>"; }).join("");
    openModal({
      eyebrow: "Salón",
      title: "Abrir Mesa " + pad2(t.number),
      bodyHtml:
        '<div class="form-row">' +
        '<div class="form-field"><label>Número de personas</label><input type="number" id="open-guests" min="1" value="' + t.capacity + '" /></div>' +
        '<div class="form-field"><label>Mesero</label><select id="open-waiter">' + waiterOptions + "</select></div>" +
        "</div>" +
        '<div class="form-field"><label>Cliente (opcional)</label><input type="text" id="open-customer" placeholder="Nombre del cliente" /></div>' +
        '<div class="field-error" id="open-table-error" hidden></div>',
      footerHtml:
        '<button class="btn-secondary" data-action="close-modal">Cancelar</button>' +
        '<button class="btn-primary" data-action="confirm-open-table" data-arg="' + t.id + '">Abrir mesa</button>'
    });
  }

  function confirmOpenTable(tableId) {
    var t = findTable(tableId);
    var guests = parseInt(document.getElementById("open-guests").value, 10);
    var waiter = document.getElementById("open-waiter").value;
    var customer = document.getElementById("open-customer").value.trim();
    var errorEl = document.getElementById("open-table-error");
    if (!guests || guests <= 0) { errorEl.textContent = "El número de personas debe ser mayor a 0."; errorEl.hidden = false; return; }
    if (!waiter) { errorEl.textContent = "Selecciona un mesero."; errorEl.hidden = false; return; }

    t.session = { openedAt: Date.now(), guests: guests };
    t.waiter = waiter;
    t.customer = customer || null;
    t.account = { folio: "F-" + String(1000 + t.number), status: "ABIERTA", discount: null, lines: [] };
    t.orders = [];

    logEvent("mesa", t.id, "TABLE_OPENED", "Mesa " + pad2(t.number) + " abierta — " + guests + " personas, mesero " + waiter);
    closeModal();
    toast("Mesa " + pad2(t.number) + " abierta");
    renderTablesGrid();
    openAccountPanel(t.id);
  }

  /* ---------------------------------------------------------------------
     RESERVATIONS (§27)
     --------------------------------------------------------------------- */

  function openReservationModal(t) {
    var r = t.reservation;
    openModal({
      eyebrow: "Reservación",
      title: "Mesa " + pad2(t.number),
      bodyHtml:
        '<div class="account-meta" style="padding:0 0 14px 0;border:none;">' +
        metaItem("Hora", r.hora) + metaItem("Cliente", r.cliente) + metaItem("Personas", r.personas) +
        "</div>" +
        (r.toleranceExceeded
          ? '<div class="notice-box warning">Tolerancia vencida (PREVIEW_RESERVATION_POLICY) — la duración real de tolerancia no está definida canónicamente; esto es solo una bandera de demostración.</div>'
          : '<div class="notice-box info">Reservación dentro de la ventana de tolerancia (PREVIEW_RESERVATION_POLICY).</div>'),
      footerHtml:
        '<button class="btn-secondary" data-action="close-modal">Cerrar</button>' +
        '<button class="btn-primary" data-action="seat-reservation" data-arg="' + t.id + '">Sentar reservación</button>'
    });
  }

  function seatReservation(tableId) {
    var t = findTable(tableId);
    var r = t.reservation;
    t.session = { openedAt: Date.now(), guests: r.personas };
    t.customer = r.cliente;
    t.waiter = WAITERS[0];
    t.account = { folio: "F-" + String(1000 + t.number), status: "ABIERTA", discount: null, lines: [] };
    t.orders = [];
    t.reservation = null;
    logEvent("mesa", t.id, "RESERVATION_SEATED", "Reservación de " + r.cliente + " sentada en Mesa " + pad2(t.number));
    closeModal();
    toast("Reservación sentada — Mesa " + pad2(t.number) + " ahora ocupada");
    renderTablesGrid();
    openAccountPanel(t.id);
  }

  function metaItem(label, value) {
    return '<div class="meta-item"><span class="meta-label">' + escapeHtml(label) + '</span><span class="meta-value">' + escapeHtml(String(value)) + "</span></div>";
  }

  /* ---------------------------------------------------------------------
     ACCOUNT PANEL (occupied / atención / por cobrar — §21/§25/§26)
     --------------------------------------------------------------------- */

  function openAccountPanel(tableId) {
    state.activeTableId = tableId;
    renderAccountPanel();
    renderTablesGrid();
    document.getElementById("account-panel").classList.add("open");
    document.getElementById("backdrop").classList.add("visible");
  }

  function closeAccountPanel() {
    document.getElementById("account-panel").classList.remove("open");
    document.getElementById("backdrop").classList.remove("visible");
    state.activeTableId = null;
    renderTablesGrid();
  }

  function renderAccountPanel() {
    var t = findTable(state.activeTableId);
    if (!t) return;
    var vs = computeVisualState(t);

    document.getElementById("account-title").textContent = "Mesa " + pad2(t.number);

    var attentionBanner = document.getElementById("attention-banner");
    if (t.attention) {
      attentionBanner.hidden = false;
      document.getElementById("attention-banner-reason").textContent = ATTENTION_CAUSE_LABEL[t.attention.cause] || t.attention.cause;
    } else {
      attentionBanner.hidden = true;
    }

    document.getElementById("account-meta").innerHTML =
      metaItem("Mesero", t.waiter) + metaItem("Personas", t.session.guests) + metaItem("Tiempo", elapsedLabel(t.session.openedAt)) +
      metaItem("Folio", t.account.folio) + metaItem("Estado", statusLabel(vs));

    renderOrderLines(t);
    renderAccountSummary(t);
    renderAccountActions(t, vs);
  }

  function renderOrderLines(t) {
    var lines = t.account.lines;
    var countLabel = "(" + lines.length + (lines.length === 1 ? " partida)" : " partidas)");
    var bodyEl = document.getElementById("account-panel-body");

    if (lines.length === 0) {
      bodyEl.innerHTML = '<div class="account-section"><h3>Partidas</h3><div class="ticket-empty" style="padding-top:30px;">Aún no hay productos en esta cuenta. Usa "Agregar productos".</div></div>';
      return;
    }

    var groups = {};
    var order = [];
    lines.forEach(function (l) {
      var key = l.orderId || "__unsent__";
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(l);
    });

    var html = '<div class="account-section" style="padding-bottom:0;"><h3 style="margin-bottom:0;">Partidas <span class="order-lines-count">' + countLabel + "</span></h3></div>";
    order.forEach(function (key) {
      var groupLines = groups[key];
      var orderObj = key === "__unsent__" ? null : t.orders.find(function (o) { return o.id === key; });
      html += '<div class="account-section">';
      if (key === "__unsent__") {
        html += '<h3>Sin enviar a cocina</h3>';
      } else {
        html += '<h3>Pedido ' + escapeHtml(key) + ' <span class="order-lines-count">— ' + kdsStatusLabel(orderObj ? orderObj.kdsStatus : "ENVIADO") + '</span></h3>';
      }
      html += '<div class="order-lines">' + groupLines.map(renderOrderLine).join("") + "</div></div>";
    });
    document.getElementById("account-panel-body").innerHTML = html;
  }

  function renderOrderLine(line) {
    var mods = line.mods.map(function (m) { return '<span class="mod-' + m.t + '">' + escapeHtml(m.label) + "</span>"; }).join("");
    return (
      '<div class="order-line"><div class="order-line-qty">' + line.qty + "×</div>" +
      '<div class="order-line-body"><div class="order-line-name"><span>' + escapeHtml(line.name) + '</span><span class="order-line-subtotal">' + fmtMoney(lineSubtotal(line)) + "</span></div>" +
      (mods ? '<div class="order-line-mods">' + mods + "</div>" : "") + "</div></div>"
    );
  }

  function renderAccountSummary(t) {
    var raw = accountRawSubtotal(t.account);
    var discount = accountDiscountAmount(t.account);
    var subtotal = accountSubtotal(t.account);
    var total = accountTotal(t.account);
    var tax = total - subtotal;

    var discRow = document.getElementById("account-discount-row");
    if (t.account.discount) {
      discRow.hidden = false;
      document.getElementById("account-discount-label").textContent =
        "(" + (t.account.discount.type === "percent" ? t.account.discount.value + "%" : fmtMoney(t.account.discount.value)) + ")";
      document.getElementById("account-discount-value").textContent = "-" + fmtMoney(discount);
    } else {
      discRow.hidden = true;
    }

    document.getElementById("account-subtotal").textContent = fmtMoney(subtotal);
    document.getElementById("account-tax").textContent = fmtMoney(tax);
    document.getElementById("account-total").textContent = fmtMoney(total);
  }

  function renderAccountActions(t, vs) {
    var primaryBtn = vs === "por_cobrar"
      ? '<button class="btn-action btn-cobrar account-action-primary" data-action="open-payment" data-arg="' + t.id + '">' + iconMoney() + "Cobrar " + fmtMoney(accountTotal(t.account)) + "</button>"
      : '<button class="btn-action btn-primary account-action-primary" data-action="add-products" data-arg="' + t.id + '">' + iconPlus() + "Agregar productos</button>";

    var kitchenBtn = vs !== "por_cobrar"
      ? '<button class="btn-action" data-action="send-to-kitchen" data-arg="' + t.id + '"' + (hasUnsentLines(t) ? "" : " disabled") + ">" + iconKitchen() + "Enviar a cocina</button>"
      : "";
    var checkBtn = (vs === "ocupada" || vs === "atencion")
      ? '<button class="btn-action" data-action="request-check" data-arg="' + t.id + '">' + iconMoney() + "Solicitar cuenta</button>"
      : "";
    var secondaryRow = (kitchenBtn || checkBtn)
      ? '<div class="account-actions-secondary-row">' + kitchenBtn + checkBtn + "</div>"
      : "";

    document.getElementById("account-actions").innerHTML =
      '<div class="account-actions-toolbar">' +
      '<button class="account-actions-more-btn" id="btn-account-more" title="Más acciones">' +
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg></button>' +
      "</div>" +
      primaryBtn +
      secondaryRow;

    bindDropdownActions(document.getElementById("account-actions"));
    document.getElementById("btn-account-more").addEventListener("click", function (e) {
      e.stopPropagation();
      openTableCardMenu(document.getElementById("btn-account-more"), t.id);
    });
  }

  function iconMoney() { return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2.5-5 1.5-5 4a2.5 2.5 0 0 0 5 0M12 6.5v11"/></svg>'; }
  function iconKitchen() { return '<svg viewBox="0 0 24 24"><path d="M4 15h16M8 15V6a4 4 0 0 1 8 0v9M6 15l1 5h10l1-5"/></svg>'; }

  function hasUnsentLines(t) {
    return t.account.lines.some(function (l) { return !l.orderId; });
  }

  function sendToKitchen(tableId) {
    var t = findTable(tableId);
    var unsent = t.account.lines.filter(function (l) { return !l.orderId; });
    if (!unsent.length) return;
    var orderId = "ORD-" + (2000 + Math.floor(Math.random() * 8000));
    unsent.forEach(function (l) { l.orderId = orderId; });
    t.orders.push({ id: orderId, kdsStatus: "ENVIADO", sentAt: Date.now() });
    logEvent("pedido", tableId, "ORDER_SENT", "Pedido " + orderId + " enviado a cocina — Mesa " + pad2(t.number) + " (" + unsent.length + " partidas)");
    toast("Enviado a cocina — " + orderId);
    renderAccountPanel();
    renderTablesGrid();
  }

  function requestCheck(tableId) {
    var t = findTable(tableId);
    t.checkRequested = true;
    logEvent("cuenta", tableId, "CHECK_REQUESTED", "Cuenta solicitada — Mesa " + pad2(t.number));
    pushNotification("check", tableId, "warning", "Mesa " + pad2(t.number) + " solicitó la cuenta");
    toast("Mesa " + pad2(t.number) + " pasó a Por cobrar");
    renderAccountPanel();
    renderTablesGrid();
  }

  function resolveAttention(tableId) {
    var t = findTable(tableId);
    if (!t.attention) return;
    logEvent("mesa", tableId, "ATTENTION_RESOLVED", "Alerta resuelta en Mesa " + pad2(t.number) + " (causa: " + t.attention.cause + ")");
    t.attention = null;
    toast("Alerta resuelta — Mesa " + pad2(t.number));
    renderAccountPanel();
    renderTablesGrid();
  }

  /* ---------------------------------------------------------------------
     POS / PRODUCT SELECTOR (unchanged UX from V2/V3 — adds lines with
     orderId:null, i.e. "sin enviar", into the active table's account)
     --------------------------------------------------------------------- */

  function enterPosMode(table) {
    state.posTicket = [];
    state.posCategory = "Favoritos";
    state.posSearch = "";
    document.getElementById("product-search").value = "";
    closeAccountPanel();
    switchView("pos");
    document.getElementById("pos-context-label").textContent = "Mesa " + pad2(table.number) + " · " + table.waiter;
    state.activeTableId = table.id;
    renderCategoryTabs();
    renderProductGrid();
    renderTicket();
  }

  function exitPosMode(reopenAccount) {
    switchView("salon");
    closeModifierModal();
    if (reopenAccount && state.activeTableId) { openAccountPanel(state.activeTableId); }
    else { state.activeTableId = null; }
  }

  function switchView(name) {
    Array.prototype.forEach.call(document.querySelectorAll(".view"), function (v) { v.classList.remove("active"); });
    var placeholderKeys = ["pedidos", "kds", "caja", "inventario", "clientes", "reportes", "configuracion"];
    var elId = name === "inicio" ? "dashboard" : (placeholderKeys.indexOf(name) !== -1 ? "placeholder" : name);
    document.getElementById("view-" + elId).classList.add("active");
    var navName = name === "pos" ? "salon" : name;
    Array.prototype.forEach.call(document.querySelectorAll(".nav-item[data-nav]"), function (n) {
      n.classList.toggle("active", n.getAttribute("data-nav") === navName);
    });
  }

  var MODULE_INFO = {
    pedidos: { label: "Pedidos", icon: "📋", purpose: "Pedidos activos por mesa, para llevar, delivery, cancelados y finalizados." },
    kds: { label: "Cocina (KDS)", icon: "🍳", purpose: "Comandas por estación, prioridad, tiempo transcurrido y estado de preparación." },
    caja: { label: "Caja", icon: "💳", purpose: "Apertura de turno, fondo inicial, cobro, movimientos de efectivo, arqueo y Cortes X/Z." },
    inventario: { label: "Inventario", icon: "📦", purpose: "Existencias, movimientos, recetas, mermas, mínimos y productos agotados." },
    clientes: { label: "Clientes", icon: "👥", purpose: "Historial de consumo, preferencias, puntos, contacto y recurrencia." },
    reportes: { label: "Reportes", icon: "📊", purpose: "Ventas, ticket promedio, productos, meseros, horarios, rotación y rentabilidad." },
    configuracion: { label: "Configuración", icon: "⚙️", purpose: "Usuarios, roles, áreas, mesas, menú, impuestos, métodos de pago e integraciones." }
  };

  function openPlaceholder(key) {
    var info = MODULE_INFO[key];
    document.getElementById("placeholder-title").textContent = info.label;
    document.getElementById("placeholder-icon").textContent = info.icon;
    document.getElementById("placeholder-heading").textContent = info.label + " — Módulo pendiente de implementación";
    document.getElementById("placeholder-purpose").textContent = info.purpose;
    closeAccountPanel();
    switchView(key);
  }

  function renderCategoryTabs() {
    var el = document.getElementById("category-tabs");
    var favIcon = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2l-5-4.9 6.9-1L12 2z"/></svg>';
    var chips = ['<button class="chip chip-favorite' + (state.posCategory === "Favoritos" ? " active" : "") + '" data-cat="Favoritos">' + favIcon + "Favoritos</button>"];
    CATEGORIES.forEach(function (c) {
      chips.push('<button class="chip' + (c === state.posCategory ? " active" : "") + '" data-cat="' + c + '">' + c + "</button>");
    });
    el.innerHTML = chips.join("");
    Array.prototype.forEach.call(el.querySelectorAll(".chip"), function (chip) {
      chip.addEventListener("click", function () {
        state.posCategory = chip.getAttribute("data-cat");
        state.posSearch = "";
        document.getElementById("product-search").value = "";
        renderCategoryTabs();
        renderProductGrid();
      });
    });
  }

  var PRODUCT_ICONS = { Entradas: "🥑", Tacos: "🌮", Platos: "🍽️", Bebidas: "🥤", Postres: "🍰" };

  function currentProductQtyInTicket(productId) {
    return state.posTicket.filter(function (l) { return l.productId === productId; }).reduce(function (s, l) { return s + l.qty; }, 0);
  }

  function visibleProducts() {
    var q = state.posSearch.trim().toLowerCase();
    if (q) return MENU.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1 || p.cat.toLowerCase().indexOf(q) !== -1; });
    if (state.posCategory === "Favoritos") return FAVORITE_IDS.map(function (id) { return MENU.find(function (m) { return m.id === id; }); });
    return MENU.filter(function (p) { return p.cat === state.posCategory; });
  }

  function renderProductGrid() {
    var grid = document.getElementById("product-grid");
    var items = visibleProducts();
    if (items.length === 0) { grid.innerHTML = '<div class="pos-search-empty">Sin resultados para tu búsqueda.</div>'; return; }
    grid.innerHTML = items.map(function (p) {
      var qty = currentProductQtyInTicket(p.id);
      var badge = qty > 0 ? '<span class="product-card-qty-badge">' + qty + "</span>" : "";
      var desc = p.desc ? '<div class="product-desc">' + escapeHtml(p.desc) + "</div>" : "";
      return '<button class="product-card" data-product-id="' + p.id + '">' + badge +
        '<span class="product-card-plus1" id="plus1-' + p.id + '">+1</span>' +
        '<div class="product-thumb cat-' + p.cat + '">' + PRODUCT_ICONS[p.cat] + '</div>' +
        '<div class="product-card-body"><div class="product-name">' + escapeHtml(p.name) + "</div>" + desc +
        '<div class="product-price">' + fmtMoney(p.price) + "</div></div></button>";
    }).join("");
    Array.prototype.forEach.call(grid.querySelectorAll(".product-card"), function (card) {
      card.addEventListener("click", function () {
        var pid = card.getAttribute("data-product-id");
        productCardFeedback(card, pid);
        if (MODIFIER_PRODUCTS[pid]) openModifierModal(pid); else addPlainToTicket(pid);
      });
    });
  }

  function productCardFeedback(card, productId) {
    card.classList.remove("pulse"); void card.offsetWidth; card.classList.add("pulse");
    var plus1 = document.getElementById("plus1-" + productId);
    if (plus1) { plus1.classList.remove("show"); void plus1.offsetWidth; plus1.classList.add("show"); }
  }

  function addPlainToTicket(productId) {
    var existing = state.posTicket.find(function (l) { return l.productId === productId && l.modsKey === ""; });
    if (existing) existing.qty += 1;
    else state.posTicket.push({ lineId: nextLineId(), productId: productId, qty: 1, modsKey: "", modsLabel: [] });
    renderTicket(); renderProductGrid();
  }

  function addModifiedToTicket(productId, modsKey, modsLabel) {
    var existing = state.posTicket.find(function (l) { return l.productId === productId && l.modsKey === modsKey; });
    if (existing) existing.qty += 1;
    else state.posTicket.push({ lineId: nextLineId(), productId: productId, qty: 1, modsKey: modsKey, modsLabel: modsLabel });
    renderTicket(); renderProductGrid();
  }

  function changeTicketQty(lineId, delta) {
    var line = state.posTicket.find(function (l) { return l.lineId === lineId; });
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) state.posTicket = state.posTicket.filter(function (l) { return l.lineId !== lineId; });
    renderTicket(); renderProductGrid();
  }

  function removeTicketLine(lineId) {
    state.posTicket = state.posTicket.filter(function (l) { return l.lineId !== lineId; });
    renderTicket(); renderProductGrid();
  }

  function renderTicket() {
    var itemsEl = document.getElementById("ticket-items");
    if (state.posTicket.length === 0) {
      itemsEl.innerHTML = '<div class="ticket-empty" id="ticket-empty">Selecciona productos del menú para agregarlos al ticket.</div>';
    } else {
      itemsEl.innerHTML = state.posTicket.map(function (line) {
        var p = MENU.find(function (m) { return m.id === line.productId; });
        var modsHtml = line.modsLabel.length ? '<div class="ticket-line-mods">' + line.modsLabel.map(function (m) { return escapeHtml(m); }).join(" · ") + "</div>" : "";
        return '<div class="ticket-line" data-line-id="' + line.lineId + '">' +
          '<div class="qty-stepper"><button data-action="dec">−</button><span>' + line.qty + '</span><button data-action="inc">+</button></div>' +
          '<div class="ticket-line-body"><div class="ticket-line-name">' + escapeHtml(p.name) + '</div><div class="ticket-line-price">' + fmtMoney(p.price) + " c/u</div>" + modsHtml + "</div>" +
          '<div class="ticket-line-subtotal">' + fmtMoney(p.price * line.qty) + "</div>" +
          '<button class="ticket-line-remove" data-action="remove" title="Quitar"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>';
      }).join("");
      Array.prototype.forEach.call(itemsEl.querySelectorAll(".ticket-line"), function (row) {
        var lid = row.getAttribute("data-line-id");
        row.querySelector('[data-action="inc"]').addEventListener("click", function () { changeTicketQty(lid, 1); });
        row.querySelector('[data-action="dec"]').addEventListener("click", function () { changeTicketQty(lid, -1); });
        row.querySelector('[data-action="remove"]').addEventListener("click", function () { removeTicketLine(lid); });
      });
    }
    var totalQty = state.posTicket.reduce(function (s, l) { return s + l.qty; }, 0);
    document.getElementById("ticket-count").textContent = totalQty + (totalQty === 1 ? " producto" : " productos");
    var subtotal = state.posTicket.reduce(function (s, l) { var p = MENU.find(function (m) { return m.id === l.productId; }); return s + p.price * l.qty; }, 0);
    var tax = subtotal * TAX_RATE;
    document.getElementById("ticket-subtotal").textContent = fmtMoney(subtotal);
    document.getElementById("ticket-tax").textContent = fmtMoney(tax);
    document.getElementById("ticket-total").textContent = fmtMoney(subtotal + tax);
    document.getElementById("btn-add-to-account").disabled = state.posTicket.length === 0;
  }

  function commitTicketToAccount() {
    var t = findTable(state.activeTableId);
    if (!t || state.posTicket.length === 0) return;
    if (!t.account) {
      t.session = { openedAt: Date.now(), guests: t.capacity };
      t.waiter = t.waiter || "Carlos Mendoza";
      t.account = { folio: "F-" + String(1000 + t.number), status: "ABIERTA", discount: null, lines: [] };
    }
    state.posTicket.forEach(function (line) {
      var p = MENU.find(function (m) { return m.id === line.productId; });
      var mods = line.modsLabel.map(function (label) { return { t: /^sin\s/i.test(label) ? "remove" : "add", label: label }; });
      t.account.lines.push({ id: nextId("l"), name: p.name, qty: line.qty, unitPrice: p.price, mods: mods, orderId: null });
    });
    logEvent("cuenta", t.id, "ITEM_ADDED", state.posTicket.length + " producto(s) agregados a la cuenta — Mesa " + pad2(t.number));
    state.posTicket = [];
    toast("Productos agregados a la cuenta");
    exitPosMode(true);
    renderTablesGrid();
  }

  /* ---------------------------------------------------------------------
     MODIFIER MODAL — UX PREVIEW ONLY (unchanged from V2/V3; OQ-SSOT-07)
     --------------------------------------------------------------------- */

  function openModifierModal(productId) {
    var p = MENU.find(function (m) { return m.id === productId; });
    var def = MODIFIER_PRODUCTS[productId];
    if (!p || !def) return;
    var selections = {};
    def.groups.forEach(function (g) { selections[g.key] = g.type === "radio" ? g.options[0].id : []; });
    state.modifier = { productId: productId, selections: selections };
    document.getElementById("modifier-product-name").textContent = p.name;
    renderModifierBody();
    document.getElementById("modifier-backdrop").classList.add("visible");
    document.getElementById("modifier-modal").classList.add("open");
  }

  function closeModifierModal() {
    state.modifier = null;
    document.getElementById("modifier-backdrop").classList.remove("visible");
    document.getElementById("modifier-modal").classList.remove("open");
  }

  function renderModifierBody() {
    var def = MODIFIER_PRODUCTS[state.modifier.productId];
    var body = document.getElementById("modifier-modal-body");
    body.innerHTML = def.groups.map(function (g) {
      var options = g.options.map(function (opt) {
        var inputType = g.type === "radio" ? "radio" : "checkbox";
        var name = "modgroup-" + g.key;
        var checked = g.type === "radio" ? state.modifier.selections[g.key] === opt.id : state.modifier.selections[g.key].indexOf(opt.id) !== -1;
        return '<div class="modifier-option"><input type="' + inputType + '" id="modopt-' + opt.id + '" name="' + name + '" data-group="' + g.key + '" data-option="' + opt.id + '"' + (checked ? " checked" : "") +
          ' /><label for="modopt-' + opt.id + '">' + escapeHtml(opt.label) + "</label></div>";
      }).join("");
      return '<div class="modifier-group"><h4>' + escapeHtml(g.label) + "</h4>" + options + "</div>";
    }).join("");
    Array.prototype.forEach.call(body.querySelectorAll("input"), function (input) {
      input.addEventListener("change", function () {
        var groupKey = input.getAttribute("data-group");
        var optionId = input.getAttribute("data-option");
        var group = def.groups.find(function (g) { return g.key === groupKey; });
        if (group.type === "radio") { state.modifier.selections[groupKey] = optionId; }
        else {
          var arr = state.modifier.selections[groupKey];
          var idx = arr.indexOf(optionId);
          if (input.checked && idx === -1) arr.push(optionId);
          if (!input.checked && idx !== -1) arr.splice(idx, 1);
        }
      });
    });
  }

  function confirmModifierSelection() {
    if (!state.modifier) return;
    var productId = state.modifier.productId;
    var def = MODIFIER_PRODUCTS[productId];
    var selections = state.modifier.selections;
    var labels = [], keyParts = [];
    def.groups.forEach(function (g) {
      if (g.type === "radio") {
        var opt = g.options.find(function (o) { return o.id === selections[g.key]; });
        if (opt) { labels.push(opt.label); keyParts.push(g.key + ":" + opt.id); }
      } else {
        var ids = selections[g.key].slice().sort();
        ids.forEach(function (id) { var o = g.options.find(function (x) { return x.id === id; }); if (o) labels.push(g.kind === "remove" ? "Sin " + o.label : o.label); });
        keyParts.push(g.key + ":" + ids.join(","));
      }
    });
    addModifiedToTicket(productId, keyParts.join("|"), labels);
    closeModifierModal();
    var p = MENU.find(function (m) { return m.id === productId; });
    toast("Agregado: " + p.name + (labels.length ? " (" + labels.join(", ") + ")" : ""));
  }

  /* ---------------------------------------------------------------------
     CHANGE WAITER (§30) / CHANGE GUESTS (§31)
     --------------------------------------------------------------------- */

  function openChangeWaiterModal(tableId) {
    var t = findTable(tableId);
    if (!hasPermission("CAN_CHANGE_WAITER")) {
      openModal({ eyebrow: "Permiso", title: "Cambiar mesero", bodyHtml: blockedNotice("CAN_CHANGE_WAITER"), footerHtml: closeOnlyFooter() });
      return;
    }
    var options = WAITERS.map(function (w) { return '<option value="' + escapeHtml(w) + '"' + (w === t.waiter ? " selected" : "") + '>' + escapeHtml(w) + "</option>"; }).join("");
    openModal({
      eyebrow: "Mesa " + pad2(t.number), title: "Cambiar mesero",
      bodyHtml: '<div class="form-field"><label>Mesero actual: ' + escapeHtml(t.waiter) + '</label><select id="new-waiter">' + options + "</select></div>",
      footerHtml: '<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-primary" data-action="confirm-change-waiter" data-arg="' + tableId + '">Confirmar</button>'
    });
  }

  function confirmChangeWaiter(tableId) {
    var t = findTable(tableId);
    var prev = t.waiter;
    var next = document.getElementById("new-waiter").value;
    t.waiter = next;
    logEvent("mesa", tableId, "WAITER_CHANGED", "Mesero de Mesa " + pad2(t.number) + ": " + prev + " → " + next);
    closeModal();
    toast("Mesero actualizado a " + next);
    renderAccountPanel(); renderTablesGrid();
  }

  function openChangeGuestsModal(tableId) {
    var t = findTable(tableId);
    openModal({
      eyebrow: "Mesa " + pad2(t.number), title: "Cambiar número de personas",
      bodyHtml: '<div class="form-field"><label>Personas</label><input type="number" id="new-guests" min="1" value="' + t.session.guests + '" /></div>',
      footerHtml: '<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-primary" data-action="confirm-change-guests" data-arg="' + tableId + '">Confirmar</button>'
    });
  }

  function confirmChangeGuests(tableId) {
    var t = findTable(tableId);
    var val = parseInt(document.getElementById("new-guests").value, 10);
    if (!val || val <= 0) return;
    var prev = t.session.guests;
    t.session.guests = val;
    logEvent("mesa", tableId, "GUEST_COUNT_CHANGED", "Personas en Mesa " + pad2(t.number) + ": " + prev + " → " + val);
    closeModal();
    toast("Personas actualizadas: " + val);
    renderAccountPanel();
  }

  function blockedNotice(cap) {
    return '<div class="notice-box danger">Tu rol (' + ROLES[CURRENT_USER.roleKey].label + ') no tiene el permiso <strong>' + cap + '</strong> (PREVIEW_POLICY_STUBS). Cambia de rol desde el menú de usuario ("Cambiar turno") para probar esta acción con permisos elevados.</div>';
  }
  function closeOnlyFooter() {
    return '<button class="btn-secondary" data-action="close-modal">Cerrar</button>';
  }

  /* ---------------------------------------------------------------------
     MOVE TABLE (§32) — PROTECTED: OQ-SSOT-02, PREVIEW_TRANSFER_VALIDATION_RESULT
     --------------------------------------------------------------------- */

  function openMoveTableModal(tableId) {
    var t = findTable(tableId);
    if (!hasPermission("CAN_MOVE_TABLE")) {
      openModal({ eyebrow: "Permiso", title: "Mover mesa", bodyHtml: blockedNotice("CAN_MOVE_TABLE"), footerHtml: closeOnlyFooter() });
      return;
    }
    var available = TABLES.filter(function (x) { return computeVisualState(x) === "disponible"; });
    var invalidExample = TABLES.find(function (x) { return computeVisualState(x) === "ocupada" && x.id !== tableId; });
    var html = '<p class="field-hint" style="margin-bottom:10px;">Selecciona la mesa destino. OQ-SSOT-02 (validación de transferencia) permanece abierta — esto es solo <code>PREVIEW_TRANSFER_VALIDATION_RESULT</code>.</p>' +
      '<div class="select-list">' +
      available.map(function (x) {
        return '<div class="select-list-item selectable" data-action="pick-move-destination" data-arg="' + tableId + ":" + x.id + '">Mesa ' + pad2(x.number) + " · " + x.zone + " · " + x.capacity + " personas</div>";
      }).join("");
    if (invalidExample) {
      html += '<div class="select-list-item disabled">Mesa ' + pad2(invalidExample.number) + " — No disponible (PREVIEW_TRANSFER_VALIDATION_RESULT: destino ocupado)</div>";
    }
    html += "</div>";
    openModal({
      eyebrow: "Mesa " + pad2(t.number), title: "Mover mesa", wide: false,
      bodyHtml: html,
      footerHtml: '<button class="btn-secondary" data-action="close-modal">Cancelar</button>'
    });
  }

  function pickMoveDestination(sourceId, destId) {
    var source = findTable(sourceId), dest = findTable(destId);
    dest.session = source.session; dest.account = source.account; dest.orders = source.orders;
    dest.waiter = source.waiter; dest.customer = source.customer; dest.attention = source.attention; dest.checkRequested = source.checkRequested;
    source.session = null; source.account = null; source.orders = []; source.attention = null; source.checkRequested = false; source.customer = null;
    logEvent("mesa", destId, "TABLE_MOVED", "Cuenta movida de Mesa " + pad2(source.number) + " a Mesa " + pad2(dest.number));
    closeModal();
    closeAccountPanel();
    toast("Mesa " + pad2(source.number) + " → Mesa " + pad2(dest.number));
    renderTablesGrid();
  }

  /* ---------------------------------------------------------------------
     MERGE TABLES (§33) — PREVIEW_TABLE_MERGE, UX only
     --------------------------------------------------------------------- */

  function openMergeTablesModal(tableId) {
    var t = findTable(tableId);
    var others = TABLES.filter(function (x) { return x.id !== tableId; });
    var html = '<p class="field-hint" style="margin-bottom:10px;">Selecciona mesas a unir con Mesa ' + pad2(t.number) + ". Esto es <code>PREVIEW_TABLE_MERGE</code> — no crea una cuenta consolidada real.</p>" +
      '<div class="select-list">' + others.map(function (x) {
        return '<label class="select-list-item"><input type="checkbox" class="merge-check" data-table="' + x.id + '" style="margin-right:8px;" />Mesa ' + pad2(x.number) + " · " + x.zone + "</label>";
      }).join("") + "</div>" +
      '<div class="form-field" style="margin-top:14px;"><label>Modo</label>' +
      '<select id="merge-mode"><option value="principal">Cuenta principal</option><option value="grupo">Grupo visual</option></select></div>';
    openModal({
      eyebrow: "Mesa " + pad2(t.number), title: "Unir mesas",
      bodyHtml: html,
      footerHtml: '<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-primary" data-action="confirm-merge" data-arg="' + tableId + '">Unir mesas</button>'
    });
  }

  function confirmMergeTables(tableId) {
    var checked = Array.prototype.filter.call(document.querySelectorAll(".merge-check"), function (c) { return c.checked; });
    var mode = document.getElementById("merge-mode").value;
    var names = checked.map(function (c) { return "Mesa " + pad2(findTable(c.getAttribute("data-table")).number); }).join(", ");
    logEvent("mesa", tableId, "TABLE_MERGE_PREVIEWED", "PREVIEW_TABLE_MERGE (" + mode + ") — Mesa " + pad2(findTable(tableId).number) + (names ? " + " + names : ""));
    closeModal();
    toast("Unión de mesas (PREVIEW) registrada — sin cambios contables reales");
  }

  /* ---------------------------------------------------------------------
     SPLIT BILL (§34) — PROTECTED: OQ-SSOT-06, PREVIEW_SPLIT_RESULT
     --------------------------------------------------------------------- */

  function openSplitBillModal(tableId) {
    var t = findTable(tableId);
    if (!t.account.lines.length) { toast("No hay partidas para dividir."); return; }
    state.splitBuckets = {}; // lineId -> "A" | "B"
    t.account.lines.forEach(function (l) { state.splitBuckets[l.id] = "A"; });
    openModal({
      eyebrow: "Mesa " + pad2(t.number), title: "Dividir cuenta", wide: true,
      bodyHtml: renderSplitBillBody(t, "producto"),
      footerHtml: '<button class="btn-secondary" data-action="close-modal">Cerrar</button><button class="btn-primary" data-action="confirm-split" data-arg="' + tableId + '">Generar PREVIEW_SPLIT_RESULT</button>'
    });
  }

  function renderSplitBillBody(t, mode) {
    var tabs = ["persona", "producto", "monto"].map(function (m) {
      var mLabel = { persona: "Por persona/asiento", producto: "Por producto", monto: "Por monto" }[m];
      return '<button class="chip' + (m === mode ? " active" : "") + '" data-action="split-tab" data-arg="' + t.id + ":" + m + '">' + mLabel + "</button>";
    }).join("");

    var body = '<div class="split-tabs">' + tabs + "</div>" +
      '<div class="notice-box info">OQ-SSOT-06 (prorrateo de descuentos/propinas) permanece abierta — este resultado es <code>PREVIEW_SPLIT_RESULT</code> y no prorratea descuentos ni propinas.</div>';

    if (mode === "producto") {
      var bucketA = t.account.lines.filter(function (l) { return state.splitBuckets[l.id] !== "B"; });
      var bucketB = t.account.lines.filter(function (l) { return state.splitBuckets[l.id] === "B"; });
      body += '<div class="select-list" style="margin-bottom:12px;">' + t.account.lines.map(function (l) {
        var bucket = state.splitBuckets[l.id];
        return '<div class="select-list-item"><span style="flex:1;">' + escapeHtml(l.name) + " (" + l.qty + "×) — " + fmtMoney(lineSubtotal(l)) + '</span>' +
          '<button class="btn-secondary" style="min-height:32px;padding:0 10px;" data-action="split-toggle-bucket" data-arg="' + t.id + ":" + l.id + '">Cuenta ' + bucket + " →</button></div>";
      }).join("") + "</div>" +
        '<div class="split-buckets"><div class="split-bucket"><h4>Cuenta A</h4>' + bucketA.map(function (l) { return '<div class="split-bucket-item"><span>' + escapeHtml(l.name) + '</span><span>' + fmtMoney(lineSubtotal(l)) + "</span></div>"; }).join("") +
        '<div class="split-bucket-total"><span>Subtotal</span><span>' + fmtMoney(bucketA.reduce(function (s, l) { return s + lineSubtotal(l); }, 0)) + "</span></div></div>" +
        '<div class="split-bucket"><h4>Cuenta B</h4>' + bucketB.map(function (l) { return '<div class="split-bucket-item"><span>' + escapeHtml(l.name) + '</span><span>' + fmtMoney(lineSubtotal(l)) + "</span></div>"; }).join("") +
        '<div class="split-bucket-total"><span>Subtotal</span><span>' + fmtMoney(bucketB.reduce(function (s, l) { return s + lineSubtotal(l); }, 0)) + "</span></div></div></div>";
    } else if (mode === "persona") {
      var guests = t.session.guests || 1;
      var perGuest = accountTotal(t.account) / guests;
      body += '<div class="form-field"><label>Número de cuentas (de ' + guests + ' comensales)</label><input type="number" id="split-guest-count" min="1" value="' + guests + '" /></div>' +
        '<p class="field-hint">Monto ilustrativo por cuenta (división simple, sin prorrateo de descuentos): ' + fmtMoney(perGuest) + "</p>";
    } else {
      body += '<div class="form-row"><div class="form-field"><label>Cuenta A</label><input type="number" id="split-amount-a" placeholder="$0.00" /></div>' +
        '<div class="form-field"><label>Cuenta B</label><input type="number" id="split-amount-b" placeholder="$0.00" /></div></div>' +
        '<p class="field-hint">Total de la cuenta: ' + fmtMoney(accountTotal(t.account)) + "</p>";
    }
    return body;
  }

  function splitTab(tableId, mode) {
    document.getElementById("generic-modal-body").innerHTML = renderSplitBillBody(findTable(tableId), mode);
    bindDropdownActions(document.getElementById("generic-modal-body"));
  }

  function splitToggleBucket(tableId, lineId) {
    state.splitBuckets[lineId] = state.splitBuckets[lineId] === "B" ? "A" : "B";
    document.getElementById("generic-modal-body").innerHTML = renderSplitBillBody(findTable(tableId), "producto");
    bindDropdownActions(document.getElementById("generic-modal-body"));
  }

  function confirmSplitBill(tableId) {
    logEvent("cuenta", tableId, "SPLIT_BILL_PREVIEWED", "PREVIEW_SPLIT_RESULT generado para Mesa " + pad2(findTable(tableId).number));
    closeModal();
    toast("PREVIEW_SPLIT_RESULT generado — no crea cuentas reales (OQ-SSOT-06 abierta)");
  }

  /* ---------------------------------------------------------------------
     DISCOUNT (§37) — PREVIEW_DISCOUNT_AUTH_POLICY
     --------------------------------------------------------------------- */

  function openDiscountModal(tableId) {
    var t = findTable(tableId);
    var authorized = hasPermission("CAN_DISCOUNT");
    openModal({
      eyebrow: "Mesa " + pad2(t.number), title: "Aplicar descuento",
      bodyHtml:
        (!authorized ? '<div class="notice-box warning" id="discount-auth-notice">Requiere autorización de gerente (PREVIEW_DISCOUNT_AUTH_POLICY). <button class="btn-secondary" style="margin-top:8px;min-height:32px;" data-action="mock-authorize" data-arg="discount">Solicitar autorización de gerente</button></div>' : "") +
        '<div class="form-row">' +
        '<div class="form-field"><label>Tipo</label><select id="discount-type"><option value="percent">Porcentaje (%)</option><option value="amount">Monto ($)</option></select></div>' +
        '<div class="form-field"><label>Valor</label><input type="number" id="discount-value" min="0" /></div>' +
        "</div>" +
        '<div class="form-field"><label>Motivo</label><textarea id="discount-reason" placeholder="Motivo del descuento"></textarea></div>',
      footerHtml: '<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-primary" id="btn-confirm-discount" data-action="confirm-discount" data-arg="' + tableId + '"' + (authorized ? "" : " disabled") + ">Aplicar</button>"
    });
  }

  function mockAuthorize(kind) {
    toast("Autorización de gerente concedida (PREVIEW)");
    var notice = document.getElementById(kind === "discount" ? "discount-auth-notice" : "cancel-auth-notice");
    if (notice) notice.remove();
    var confirmBtn = document.getElementById(kind === "discount" ? "btn-confirm-discount" : "btn-confirm-cancel");
    if (confirmBtn) confirmBtn.disabled = false;
  }

  function confirmDiscount(tableId) {
    var t = findTable(tableId);
    var type = document.getElementById("discount-type").value === "percent" ? "percent" : "amount";
    var value = parseFloat(document.getElementById("discount-value").value) || 0;
    var reason = document.getElementById("discount-reason").value.trim();
    if (!value || !reason) { toast("Captura un valor y un motivo."); return; }
    t.account.discount = { type: type, value: value, reason: reason };
    logEvent("cuenta", tableId, "DISCOUNT_APPLIED", "Descuento (" + (type === "percent" ? value + "%" : fmtMoney(value)) + ") aplicado a Mesa " + pad2(t.number) + " — " + reason);
    closeModal();
    toast("Descuento aplicado (PREVIEW)");
    renderAccountPanel();
  }

  /* ---------------------------------------------------------------------
     CANCEL ACCOUNT (§38) — PROTECTED: OQ-SSOT-01, PREVIEW_CANCELLATION_POLICY
     --------------------------------------------------------------------- */

  function openCancelAccountModal(tableId) {
    var t = findTable(tableId);
    var authorized = hasPermission("CAN_CANCEL_ACCOUNT");
    openModal({
      eyebrow: "Acción sensible", title: "Cancelar cuenta — Mesa " + pad2(t.number),
      bodyHtml:
        '<div class="notice-box danger">OQ-SSOT-01 (política de cancelación post-cocina) permanece abierta. Esta acción usa <code>PREVIEW_CANCELLATION_POLICY</code> únicamente para demostrar el flujo de permisos/auditoría.</div>' +
        (!authorized ? '<div class="notice-box warning" id="cancel-auth-notice">Requiere autorización de gerente. <button class="btn-secondary" style="margin-top:8px;min-height:32px;" data-action="mock-authorize" data-arg="cancel">Solicitar autorización de gerente</button></div>' : "") +
        '<div class="form-field"><label>Motivo (obligatorio)</label><textarea id="cancel-reason" placeholder="Motivo de la cancelación"></textarea></div>',
      footerHtml: '<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-primary" id="btn-confirm-cancel" data-action="confirm-cancel-account" data-arg="' + tableId + '"' + (authorized ? "" : " disabled") + ' style="background:var(--danger-500);border-color:var(--danger-500);">Cancelar cuenta</button>'
    });
  }

  function confirmCancelAccount(tableId) {
    var t = findTable(tableId);
    var reason = document.getElementById("cancel-reason").value.trim();
    if (!reason) { toast("Captura un motivo."); return; }
    logEvent("cuenta", tableId, "ACCOUNT_CLOSED", "Cuenta cancelada — Mesa " + pad2(t.number) + " — " + reason);
    logEvent("mesa", tableId, "TABLE_RELEASED", "Mesa " + pad2(t.number) + " liberada tras cancelación");
    releaseTableToAvailable(t);
    closeModal(); closeAccountPanel();
    toast("Cuenta cancelada — Mesa " + pad2(t.number) + " liberada");
    renderTablesGrid();
  }

  function releaseTableToAvailable(t) {
    t.session = null; t.account = null; t.orders = []; t.attention = null; t.checkRequested = false; t.customer = null;
  }

  /* ---------------------------------------------------------------------
     RELEASE TABLE (§39) — CAN_FORCE_RELEASE
     --------------------------------------------------------------------- */

  function openReleaseTableModal(tableId) {
    var t = findTable(tableId);
    var balance = accountTotal(t.account);
    var canForce = hasPermission("CAN_FORCE_RELEASE");
    if (balance <= 0) {
      openModal({
        eyebrow: "Mesa " + pad2(t.number), title: "Liberar mesa",
        bodyHtml: '<p style="font-size:14px;">La cuenta no tiene saldo pendiente. ¿Liberar la mesa?</p>',
        footerHtml: '<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-primary" data-action="confirm-release" data-arg="' + tableId + '">Liberar mesa</button>'
      });
      return;
    }
    openModal({
      eyebrow: "Mesa " + pad2(t.number), title: "Liberar mesa",
      bodyHtml:
        '<div class="notice-box danger">La cuenta tiene un saldo pendiente de ' + fmtMoney(balance) + '. Por política, no se libera una mesa con saldo pendiente salvo excepción administrativa.</div>' +
        (canForce ? '<p class="field-hint">Tu rol (' + ROLES[CURRENT_USER.roleKey].label + ") permite una excepción administrativa (CAN_FORCE_RELEASE)." : '<p class="field-hint">Tu rol (' + ROLES[CURRENT_USER.roleKey].label + ") no tiene permiso CAN_FORCE_RELEASE."),
      footerHtml: '<button class="btn-secondary" data-action="close-modal">Cerrar</button>' +
        (canForce ? '<button class="btn-primary" data-action="confirm-force-release" data-arg="' + tableId + '" style="background:var(--danger-500);border-color:var(--danger-500);">Excepción administrativa: liberar</button>' : "")
    });
  }

  function confirmReleaseTable(tableId, forced) {
    var t = findTable(tableId);
    logEvent("mesa", tableId, "TABLE_RELEASED", "Mesa " + pad2(t.number) + " liberada" + (forced ? " (excepción administrativa CAN_FORCE_RELEASE)" : ""));
    releaseTableToAvailable(t);
    closeModal(); closeAccountPanel();
    toast("Mesa " + pad2(t.number) + " liberada");
    renderTablesGrid();
  }

  /* ---------------------------------------------------------------------
     PRECHECK / PRECUENTA (§35)
     --------------------------------------------------------------------- */

  function openPrecheckModal(tableId) {
    var t = findTable(tableId);
    openModal({
      eyebrow: "Mesa " + pad2(t.number), title: "Imprimir precuenta",
      bodyHtml: renderPrecheckHtml(t),
      footerHtml: '<button class="btn-secondary" data-action="close-modal">Cerrar</button><button class="btn-primary" data-action="confirm-print-precheck" data-arg="' + tableId + '">Imprimir</button>'
    });
  }

  function renderPrecheckHtml(t) {
    var subtotal = accountSubtotal(t.account), total = accountTotal(t.account), tax = total - subtotal;
    return '<div class="precheck-preview" id="precheck-content">' +
      '<div class="precheck-label">PRECUENTA</div>' +
      '<div class="precheck-row"><span>TRIDENTPOS</span><span>Sucursal ' + escapeHtml(currentBranch) + "</span></div>" +
      '<div class="precheck-row"><span>Mesa</span><span>' + pad2(t.number) + "</span></div>" +
      '<div class="precheck-row"><span>Mesero</span><span>' + escapeHtml(t.waiter) + "</span></div><hr/>" +
      t.account.lines.map(function (l) { return '<div class="precheck-row"><span>' + l.qty + "× " + escapeHtml(l.name) + '</span><span>' + fmtMoney(lineSubtotal(l)) + "</span></div>"; }).join("") +
      "<hr/>" +
      '<div class="precheck-row"><span>Subtotal</span><span>' + fmtMoney(subtotal) + "</span></div>" +
      '<div class="precheck-row"><span>IVA</span><span>' + fmtMoney(tax) + "</span></div>" +
      '<div class="precheck-row" style="font-weight:700;"><span>TOTAL</span><span>' + fmtMoney(total) + "</span></div>" +
      "</div>";
  }

  function confirmPrintPrecheck(tableId) {
    var t = findTable(tableId);
    document.getElementById("print-area").innerHTML = document.getElementById("precheck-content").outerHTML;
    logEvent("cuenta", tableId, "PRECHECK_PRINTED", "Precuenta impresa — Mesa " + pad2(t.number));
    if (t.account.status === "ABIERTA") t.account.status = "IMPRESA";
    window.print();
    closeModal();
    toast("Precuenta enviada a impresión");
    renderAccountPanel(); renderTablesGrid();
  }

  /* ---------------------------------------------------------------------
     HISTORY / EVENT LOG (§36)
     --------------------------------------------------------------------- */

  function openHistoryModal(tableId) {
    var t = tableId ? findTable(tableId) : null;
    var entries = tableId ? EVENT_LOG.filter(function (e) { return e.entityId === tableId; }) : EVENT_LOG;
    openModal({
      eyebrow: "Historial", title: t ? "Mesa " + pad2(t.number) : "Historial global", wide: true,
      bodyHtml: entries.length
        ? '<div class="history-list">' + entries.map(function (e) {
            var d = new Date(e.timestamp);
            return '<div class="history-item"><span class="history-time">' + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + '</span>' +
              '<div class="history-body"><span class="history-type">' + e.eventType + "</span><br><span class=\"history-summary\">" + escapeHtml(e.summary) + '</span><br><span class="history-actor">' + escapeHtml(e.actor) + "</span></div></div>";
          }).join("") + "</div>"
        : '<div class="ticket-empty">Sin eventos registrados todavía.</div>',
      footerHtml: '<button class="btn-secondary" data-action="close-modal">Cerrar</button>'
    });
  }

  /* ---------------------------------------------------------------------
     PAYMENT MODAL (§40-45) — PREVIEW_ONLY, no real terminal/Caja/Folio.
     --------------------------------------------------------------------- */

  function openPaymentModal(tableId) {
    var t = findTable(tableId);
    var total = accountTotal(t.account);
    state.payment = { tableId: tableId, tip: 0, lines: [] };
    openModal({
      eyebrow: "Cobro", title: "Cobrar — Mesa " + pad2(t.number), wide: true,
      bodyHtml: renderPaymentBody(),
      footerHtml: '<button class="btn-secondary" data-action="close-modal">Cancelar</button>' +
        '<button class="btn-primary" id="btn-confirm-close-payment" data-action="confirm-close-payment" disabled>Confirmar cierre</button>'
    });
    logEvent("cuenta", tableId, "PAYMENT_STARTED", "Cobro iniciado — Mesa " + pad2(t.number) + " — Total " + fmtMoney(total));
  }

  function paymentRemaining() {
    var t = findTable(state.payment.tableId);
    var total = accountTotal(t.account) + (state.payment.tip || 0);
    var paid = state.payment.lines.filter(function (l) { return l.status !== "declined"; }).reduce(function (s, l) { return s + l.amount; }, 0);
    return total - paid;
  }

  function renderPaymentBody() {
    var t = findTable(state.payment.tableId);
    var total = accountTotal(t.account);
    var tip = state.payment.tip || 0;
    var paid = state.payment.lines.filter(function (l) { return l.status !== "declined"; }).reduce(function (s, l) { return s + l.amount; }, 0);
    var remaining = total + tip - paid;

    var html = '<div class="payment-summary-grid">' +
      paymentCell("Total", fmtMoney(total)) +
      paymentCell("Propina", fmtMoney(tip)) +
      paymentCell("Pagado", fmtMoney(paid)) +
      paymentCell("Saldo pendiente", fmtMoney(Math.max(0, remaining)), remaining <= 0.005 ? "remaining paid" : "remaining") +
      "</div>";

    html += '<div class="form-field"><label>Propina</label><div class="payment-method-tabs">' +
      [0, 0.10, 0.15, 0.20].map(function (pct) {
        return '<button class="chip" data-action="set-tip-pct" data-arg="' + pct + '">' + (pct === 0 ? "Sin propina" : (pct * 100) + "%") + "</button>";
      }).join("") + "</div></div>";

    html += '<div class="payment-method-tabs">' +
      '<button class="chip" data-action="add-payment-line" data-arg="tarjeta">+ Tarjeta</button>' +
      '<button class="chip" data-action="add-payment-line" data-arg="efectivo">+ Efectivo</button>' +
      '<button class="chip" data-action="add-payment-line" data-arg="transferencia">+ Transferencia</button>' +
      "</div>";

    html += '<div class="payment-line-list">' + state.payment.lines.map(renderPaymentLine).join("") + "</div>";
    return html;
  }

  function paymentCell(label, value, extraClass) {
    return '<div class="payment-summary-cell' + (extraClass ? " " + extraClass : "") + '"><div class="label">' + label + '</div><div class="value">' + value + "</div></div>";
  }

  function renderPaymentLine(l, i) {
    var methodLabel = { tarjeta: "Tarjeta", efectivo: "Efectivo", transferencia: "Transferencia" }[l.method];
    var extra = "";
    if (l.method === "tarjeta") {
      extra = l.status === "declined" ? ' — <strong style="color:var(--danger-500);">Declinado</strong>' : ' — <strong style="color:var(--status-success);">Aprobado</strong> (ref ' + l.ref + ")";
    } else if (l.method === "efectivo") {
      extra = " — Recibido " + fmtMoney(l.received) + " · Cambio " + fmtMoney(Math.max(0, l.received - l.amount));
    } else if (l.method === "transferencia") {
      extra = " — Ref " + l.ref;
    }
    return '<div class="payment-line"><span>' + methodLabel + " " + fmtMoney(l.amount) + extra + '</span>' +
      '<button class="payment-line-remove" data-action="remove-payment-line" data-arg="' + i + '"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>';
  }

  function setTip(pct) {
    var t = findTable(state.payment.tableId);
    state.payment.tip = accountTotal(t.account) * pct;
    refreshPaymentBody();
  }

  function addPaymentLine(method) {
    var remaining = Math.max(0, paymentRemaining());
    var line = { method: method, amount: Math.round(remaining * 100) / 100 };
    if (method === "tarjeta") { line.ref = "AUT" + Math.floor(100000 + Math.random() * 900000); line.status = "approved"; }
    if (method === "efectivo") { line.received = line.amount; }
    if (method === "transferencia") { line.ref = "TRF" + Math.floor(100000 + Math.random() * 900000); }
    state.payment.lines.push(line);
    refreshPaymentBody();
  }

  function removePaymentLine(index) {
    state.payment.lines.splice(index, 1);
    refreshPaymentBody();
  }

  function refreshPaymentBody() {
    document.getElementById("generic-modal-body").innerHTML = renderPaymentBody();
    bindDropdownActions(document.getElementById("generic-modal-body"));
    var remaining = paymentRemaining();
    document.getElementById("btn-confirm-close-payment").disabled = remaining > 0.005;
  }

  function confirmClosePayment() {
    var t = findTable(state.payment.tableId);
    state.payment.lines.forEach(function (l) {
      if (l.status === "declined") return;
      logEvent("pago", t.id, "PAYMENT_RECORDED", l.method + " " + fmtMoney(l.amount) + " — Mesa " + pad2(t.number));
    });
    t.account.status = "PAGADA";
    logEvent("cuenta", t.id, "ACCOUNT_CLOSED", "Cuenta cerrada — Mesa " + pad2(t.number) + " — Total " + fmtMoney(accountTotal(t.account)));
    logEvent("mesa", t.id, "TABLE_RELEASED", "Mesa " + pad2(t.number) + " liberada tras cobro");
    releaseTableToAvailable(t);
    closeModal();
    closeAccountPanel();
    toast("Cuenta cerrada — Mesa " + pad2(t.number) + " disponible");
    renderTablesGrid();
  }

  /* ---------------------------------------------------------------------
     CENTRAL ACTION DISPATCHER — every [data-action] button in the app
     (dropdowns, modals, cards) routes through here.
     --------------------------------------------------------------------- */

  function dispatchDropdownAction(action, arg, btn) {
    var parts = arg ? arg.split(":") : [];
    switch (action) {
      case "close-modal": closeModal(); break;

      case "filter-status":
        state.statusFilter = state.statusFilter === arg ? null : arg;
        closeAllDropdowns(); renderTablesGrid(); break;
      case "reset-filters":
        state.statusFilter = null; state.zone = "todos"; state.onlyMine = false;
        Array.prototype.forEach.call(document.querySelectorAll("#zone-tabs .chip"), function (c) { c.classList.toggle("active", c.getAttribute("data-zone") === "todos"); });
        renderTablesGrid(); break;

      case "sort-mode": state.sortMode = arg; closeAllDropdowns(); renderTablesGrid(); break;
      case "toggle-only-mine": state.onlyMine = !state.onlyMine; closeAllDropdowns(); renderTablesGrid(); break;
      case "toggle-show-reservations": state.showReservations = !state.showReservations; closeAllDropdowns(); renderTablesGrid(); break;
      case "fullscreen-toggle":
        closeAllDropdowns();
        if (document.fullscreenElement) document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () { toast("Pantalla completa no disponible en este navegador."); });
        break;
      case "configure-salon":
        closeAllDropdowns();
        state.floorConfigMode = true;
        setViewMode("floor");
        if (!hasPermission("CAN_EDIT_FLOOR_PLAN")) toast("Tu rol no puede editar el plano — modo solo lectura (PREVIEW_POLICY_STUBS)");
        else toast("Modo configuración activo — arrastra las mesas");
        break;
      case "print-floor-map":
        closeAllDropdowns();
        printFloorMap();
        break;

      case "switch-branch": requestBranchSwitch(arg); break;
      case "confirm-branch-switch": switchBranch(arg); closeModal(); break;
      case "toast-only": closeAllDropdowns(); toast(arg); break;
      case "change-shift": changeShift(); break;
      case "open-branch-from-user":
        closeAllDropdowns();
        toggleDropdown(document.getElementById("branch-dropdown"), buildBranchDropdownHtml);
        break;

      case "open-notification": openNotificationEntry(arg); break;
      case "mark-notif-read": markNotifRead(arg); break;

      case "demo-attention-active": {
        var t1 = state.activeTableId ? findTable(state.activeTableId) : null;
        if (t1) { triggerAttention(t1, arg); closeAllDropdowns(); }
        break;
      }
      case "demo-advance-kds": advanceKdsForActiveTable(); break;
      case "demo-random-attention": {
        var t2 = randomOccupiedTable();
        if (t2) { triggerAttention(t2, arg); closeAllDropdowns(); toast("Alerta simulada en Mesa " + pad2(t2.number)); }
        else toast("No hay mesas ocupadas disponibles para simular.");
        break;
      }
      case "demo-random-checkrequest": {
        var t3 = TABLES.find(function (x) { return x.session && underlyingVisualState(x) === "ocupada" && !x.attention; });
        if (t3) { requestCheck(t3.id); closeAllDropdowns(); }
        else toast("No hay mesas ocupadas disponibles.");
        break;
      }
      case "demo-stock-alert": pushNotification("stock", null, "critical", "Salsa BBQ agotada — bloquea nuevas órdenes de Costillas BBQ"); closeAllDropdowns(); toast("Alerta de producto agotado simulada"); break;
      case "demo-lowstock-alert": pushNotification("stock", null, "warning", "Filete de Salmón: stock bajo (mínimo alcanzado)"); closeAllDropdowns(); toast("Alerta de stock bajo simulada"); break;

      case "search-select": closeSearch(); switchView("salon"); openAccountPanel(arg); break;

      case "table-menu-seat": closeAllDropdowns(); openReservationModal(findTable(arg)); break;
      case "table-menu-open": closeAllDropdowns(); openOpenTableModal(findTable(arg)); break;
      case "table-menu-waiter": closeAllDropdowns(); openChangeWaiterModal(arg); break;
      case "table-menu-guests": closeAllDropdowns(); openChangeGuestsModal(arg); break;
      case "table-menu-move": closeAllDropdowns(); openMoveTableModal(arg); break;
      case "table-menu-merge": closeAllDropdowns(); openMergeTablesModal(arg); break;
      case "table-menu-split": closeAllDropdowns(); openSplitBillModal(arg); break;
      case "table-menu-precheck": closeAllDropdowns(); openPrecheckModal(arg); break;
      case "table-menu-history": closeAllDropdowns(); openHistoryModal(arg); break;
      case "table-menu-discount": closeAllDropdowns(); openDiscountModal(arg); break;
      case "table-menu-cancel": closeAllDropdowns(); openCancelAccountModal(arg); break;
      case "table-menu-release": closeAllDropdowns(); openReleaseTableModal(arg); break;

      case "confirm-open-table": confirmOpenTable(arg); break;
      case "seat-reservation": seatReservation(arg); break;

      case "add-products": enterPosMode(findTable(arg)); break;
      case "send-to-kitchen": sendToKitchen(arg); break;
      case "request-check": requestCheck(arg); break;
      case "open-payment": openPaymentModal(arg); break;

      case "confirm-change-waiter": confirmChangeWaiter(arg); break;
      case "confirm-change-guests": confirmChangeGuests(arg); break;

      case "pick-move-destination": pickMoveDestination(parts[0], parts[1]); break;
      case "confirm-merge": confirmMergeTables(arg); break;

      case "split-tab": splitTab(parts[0], parts[1]); break;
      case "split-toggle-bucket": splitToggleBucket(parts[0], parts[1]); break;
      case "confirm-split": confirmSplitBill(arg); break;

      case "mock-authorize": mockAuthorize(arg); break;
      case "confirm-discount": confirmDiscount(arg); break;
      case "confirm-cancel-account": confirmCancelAccount(arg); break;
      case "confirm-release": confirmReleaseTable(arg, false); break;
      case "confirm-force-release": confirmReleaseTable(arg, true); break;
      case "confirm-print-precheck": confirmPrintPrecheck(arg); break;

      case "set-tip-pct": setTip(parseFloat(arg)); break;
      case "add-payment-line": addPaymentLine(arg); break;
      case "remove-payment-line": removePaymentLine(parseInt(arg, 10)); break;
      case "confirm-close-payment": confirmClosePayment(); break;

      default: break;
    }
  }

  function printFloorMap() {
    var visible = visibleTables();
    var html = '<h2 style="font-family:sans-serif;">Mapa de mesas — Sucursal ' + escapeHtml(currentBranch) + "</h2>" +
      '<table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px;"><thead><tr>' +
      "<th style=\"text-align:left;border-bottom:1px solid #ccc;padding:6px;\">Mesa</th><th style=\"text-align:left;border-bottom:1px solid #ccc;padding:6px;\">Zona</th><th style=\"text-align:left;border-bottom:1px solid #ccc;padding:6px;\">Estado</th></tr></thead><tbody>" +
      visible.map(function (t) {
        return "<tr><td style=\"padding:6px;border-bottom:1px solid #eee;\">Mesa " + pad2(t.number) + "</td><td style=\"padding:6px;border-bottom:1px solid #eee;\">" + escapeHtml(t.zone) + "</td><td style=\"padding:6px;border-bottom:1px solid #eee;\">" + statusLabel(computeVisualState(t)) + "</td></tr>";
      }).join("") + "</tbody></table>";
    document.getElementById("print-area").innerHTML = html;
    logEvent("salon", "global", "FLOOR_MAP_PRINTED", "Mapa de mesas impreso (PREVIEW)");
    window.print();
  }

  /* ---------------------------------------------------------------------
     DASHBOARD CONCEPT PREVIEW (§9) — unchanged from V3, now reachable via
     the real "Inicio" nav item, still PREVIEW_FIXTURE_DATA throughout.
     --------------------------------------------------------------------- */

  function gaugeSvg(pct, color) {
    var r = 22, c = 2 * Math.PI * r, offset = c * (1 - pct / 100);
    return '<svg class="gauge-ring" width="56" height="56" viewBox="0 0 56 56">' +
      '<circle cx="28" cy="28" r="' + r + '" fill="none" stroke="var(--surface-muted)" stroke-width="6"/>' +
      '<circle cx="28" cy="28" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + offset + '" transform="rotate(-90 28 28)"/></svg>';
  }

  function renderDashboardPreview() {
    var el = document.getElementById("dashboard-grid");
    if (!el) return;
    var counts = statusCounts();
    var kpis = [
      { label: "Mesas ocupadas", value: counts.ocupada + counts.atencion + counts.por_cobrar + " / " + TABLES.length, trend: "+3 vs. ayer", dir: "up" },
      { label: "Ventas del día", value: "$18,423", trend: "+8.4%", dir: "up" },
      { label: "Órdenes activas", value: String(TABLES.reduce(function (s, t) { return s + t.orders.length; }, 0)), trend: "sin cambio", dir: "flat" },
      { label: "Ticket promedio", value: "$542", trend: "-2.1%", dir: "down" }
    ];
    var kpiHtml = kpis.map(function (k) {
      return '<div class="kpi-card"><span class="kpi-label">' + escapeHtml(k.label) + '</span><span class="kpi-value">' + escapeHtml(k.value) + '</span><span class="kpi-trend ' + k.dir + '">' + escapeHtml(k.trend) + "</span></div>";
    }).join("");
    var insights = [
      { title: "Cocina", value: "En preparación", pct: 58, color: "var(--status-warning)" },
      { title: "Mesas", value: counts.ocupada + " ocupadas de " + TABLES.length, pct: Math.round((counts.ocupada / TABLES.length) * 100), color: "var(--status-info)" },
      { title: "Ventas vs. meta", value: "65% de la meta diaria", pct: 65, color: "var(--status-success)" }
    ];
    var insightsHtml = insights.map(function (i) {
      return '<div class="insight-row">' + gaugeSvg(i.pct, i.color) + '<div class="insight-body"><div class="insight-title">' + escapeHtml(i.title) + '</div><div class="insight-value">' + escapeHtml(i.value) + "</div></div></div>";
    }).join("");
    var feed = EVENT_LOG.slice(0, 6).map(function (e) {
      return '<div class="feed-item"><span class="feed-dot info"></span><div class="insight-body"><div class="feed-title">' + escapeHtml(e.eventType) + '</div><div class="feed-sub">' + escapeHtml(e.summary) + "</div></div></div>";
    }).join("") || '<div class="feed-item"><div class="insight-body"><div class="feed-sub">Sin actividad todavía en esta sesión.</div></div></div>';

    el.innerHTML = '<div class="kpi-row">' + kpiHtml + "</div>" +
      '<div class="dashboard-columns"><div class="panel-card"><h3>Operational Feed</h3><div class="feed-list">' + feed + "</div></div>" +
      '<div class="panel-card"><h3>Quick Insights</h3>' + insightsHtml + "</div></div>";
  }

  function renderDesignSystemOverview() {
    var el = document.getElementById("ds-grid");
    if (!el) return;
    el.innerHTML = '<div class="ds-section"><h3>V4 nota</h3><p style="font-size:13px;color:var(--text-secondary);">El inventario visual completo vive en <code>docs/design/TRIDENTPOS_VISUAL_REFERENCE_SPEC.md</code> y no cambió en V4 (expansión funcional, no rediseño).</p></div>';
  }

  /* ---------------------------------------------------------------------
     CLOCK
     --------------------------------------------------------------------- */

  function tickClock() {
    var now = new Date();
    document.getElementById("topbar-clock").textContent = pad2(now.getHours()) + ":" + pad2(now.getMinutes());
  }

  function initSearchInput() {
    var input = document.getElementById("product-search");
    input.addEventListener("input", function () {
      state.posSearch = input.value;
      if (state.posSearch.trim()) { Array.prototype.forEach.call(document.querySelectorAll("#category-tabs .chip"), function (c) { c.classList.remove("active"); }); }
      else { renderCategoryTabs(); }
      renderProductGrid();
    });
  }

  /* ---------------------------------------------------------------------
     KEYBOARD SHORTCUTS — priority: search > generic modal > modifier modal
     > account drawer. Preview convenience only.
     --------------------------------------------------------------------- */

  function initKeyboard() {
    document.addEventListener("keydown", function (e) {
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      var isCmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");

      if (isCmdK) { e.preventDefault(); if (isSearchOpen()) closeSearch(); else openSearch(); return; }

      var isSlash = e.key === "/" && !typing;
      if (isSlash && document.getElementById("view-pos").classList.contains("active")) {
        e.preventDefault(); document.getElementById("product-search").focus(); return;
      }

      if (e.key === "Escape") {
        if (isSearchOpen()) { closeSearch(); return; }
        if (document.getElementById("modifier-modal").classList.contains("open")) { closeModifierModal(); return; }
        if (isModalOpen()) { closeModal(); return; }
        if (openDropdownEl) { closeAllDropdowns(); return; }
        if (document.getElementById("account-panel").classList.contains("open")) { closeAccountPanel(); return; }
      }
    });
  }

  /* ---------------------------------------------------------------------
     WIRE UP
     --------------------------------------------------------------------- */

  function init() {
    initSidebar();
    initTopbar();
    initSearchInput();
    initKeyboard();

    Array.prototype.forEach.call(document.querySelectorAll("#zone-tabs .chip"), function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("#zone-tabs .chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        state.zone = chip.getAttribute("data-zone");
        renderTablesGrid();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll(".sidebar .nav-item[data-nav]"), function (item) {
      item.addEventListener("click", function () {
        var target = item.getAttribute("data-nav");
        closeAccountPanel();
        if (target === "salon") { exitPosMode(false); switchView("salon"); return; }
        if (target === "inicio") { renderDashboardPreview(); switchView("inicio"); return; }
        openPlaceholder(target);
      });
    });

    document.getElementById("btn-close-panel").addEventListener("click", closeAccountPanel);
    document.getElementById("backdrop").addEventListener("click", closeAccountPanel);
    document.getElementById("btn-back-to-salon").addEventListener("click", function () { exitPosMode(true); });
    document.getElementById("btn-add-to-account").addEventListener("click", commitTicketToAccount);

    document.getElementById("btn-close-modifier").addEventListener("click", closeModifierModal);
    document.getElementById("btn-modifier-cancel").addEventListener("click", closeModifierModal);
    document.getElementById("btn-modifier-add").addEventListener("click", confirmModifierSelection);
    document.getElementById("modifier-backdrop").addEventListener("click", closeModifierModal);

    document.getElementById("btn-close-generic-modal").addEventListener("click", closeModal);
    document.getElementById("generic-modal-backdrop").addEventListener("click", closeModal);

    document.getElementById("search-backdrop").addEventListener("click", closeSearch);
    document.getElementById("global-search-input").addEventListener("input", function (e) { renderSearchResults(e.target.value); });

    document.getElementById("btn-resolve-attention").addEventListener("click", function () {
      if (state.activeTableId) resolveAttention(state.activeTableId);
    });

    document.getElementById("btn-open-account-cta").addEventListener("click", function () {
      var firstAvailable = TABLES.find(function (t) { return computeVisualState(t) === "disponible"; });
      if (firstAvailable) openOpenTableModal(firstAvailable);
      else toast("No hay mesas disponibles en este momento.");
    });

    Array.prototype.forEach.call(document.querySelectorAll(".view-toggle-btn"), function (btn) {
      btn.addEventListener("click", function () { setViewMode(btn.getAttribute("data-view-mode")); });
    });

    document.getElementById("btn-salon-menu").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleDropdown(document.getElementById("salon-menu-dropdown"), buildSalonMenuHtml);
    });

    document.getElementById("insight-banner-close").addEventListener("click", dismissCurrentInsight);

    renderInsightBanner();
    renderTablesGrid();
    tickClock();
    setInterval(tickClock, 15000);
    setInterval(renderTablesGrid, 30000);

    applyScreenshotScene();
  }

  /**
   * Screenshot/QA helper ONLY — deterministic scenarios via query string,
   * e.g. index.html?qa=07 (see docs/design/TRIDENTPOS_SALON_FUNCTIONAL_PREVIEW_SPEC.md
   * and the preview README for the full list). Not part of the product UX.
   */
  function applyScreenshotScene() {
    var params = new URLSearchParams(window.location.search);

    var sidebarOverride = params.get("sidebar");
    if (sidebarOverride === "collapsed" || sidebarOverride === "expanded") applySidebarState(sidebarOverride === "collapsed");

    var scene = params.get("scene");
    if (scene === "dashboard") { renderDashboardPreview(); switchView("inicio"); return; }
    if (scene === "design-system") { renderDesignSystemOverview(); switchView("design-system"); return; }

    var qa = params.get("qa");
    if (!qa) return;

    switch (qa) {
      case "01": switchView("salon"); break;
      case "02": openOpenTableModal(findTable("mesa-1")); break;
      case "03":
        findTable("mesa-2").session = { openedAt: Date.now(), guests: 2 };
        findTable("mesa-2").waiter = "Carlos M.";
        findTable("mesa-2").account = { folio: "F-1002", status: "ABIERTA", discount: null, lines: [] };
        renderTablesGrid();
        break;
      case "04": openAccountPanel("mesa-3"); break;
      case "05": enterPosMode(findTable("mesa-5")); break;
      case "06": openAccountPanel("mesa-3"); sendToKitchen("mesa-3"); break;
      case "07": openAccountPanel("mesa-11"); break;
      case "08": triggerAttention(findTable("mesa-7"), "KDS_DELAY"); openAccountPanel("mesa-7"); break;
      case "09": resolveAttention("mesa-11"); openAccountPanel("mesa-11"); break;
      case "10": requestCheck("mesa-3"); openAccountPanel("mesa-3"); break;
      case "11": openAccountPanel("mesa-14"); break;
      case "12": openAccountPanel("mesa-14"); openPaymentModal("mesa-14"); addPaymentLine("tarjeta"); break;
      case "13": openAccountPanel("mesa-14"); openPaymentModal("mesa-14"); addPaymentLine("efectivo"); break;
      case "14": openAccountPanel("mesa-14"); openPaymentModal("mesa-14"); setTip(0.10); addPaymentLine("tarjeta"); state.payment.lines[0].amount = Math.round(accountTotal(findTable("mesa-14").account) / 2); addPaymentLine("efectivo"); refreshPaymentBody(); break;
      case "15": openAccountPanel("mesa-18"); openPaymentModal("mesa-18"); addPaymentLine("tarjeta"); confirmClosePayment(); break;
      case "16": switchView("salon"); break;
      case "17": openReservationModal(findTable("mesa-2")); break;
      case "18": seatReservation("mesa-15"); break;
      case "19": openAccountPanel("mesa-3"); openMoveTableModal("mesa-3"); break;
      case "20": openAccountPanel("mesa-18"); openSplitBillModal("mesa-18"); break;
      case "21": openAccountPanel("mesa-3"); openChangeWaiterModal("mesa-3"); break;
      case "22": openHistoryModal(null); break;
      case "23": openSearch(); document.getElementById("global-search-input").value = "mesa 07"; renderSearchResults("mesa 07"); break;
      case "24":
        triggerAttention(findTable("mesa-7"), "CUSTOMER_CALL");
        pushNotification("stock", null, "warning", "Filete de Salmón: stock bajo (mínimo alcanzado)");
        toggleDropdown(document.getElementById("notif-panel"), buildNotifPanelHtml);
        break;
      case "menu": openTableCardMenu({ getBoundingClientRect: function () { return { bottom: 300, left: 300 }; } }, "mesa-3"); break;
      case "25": state.zone = "Terraza"; renderTablesGrid(); break;
      case "26": state.statusFilter = "ocupada"; renderTablesGrid(); break;
      case "27": setViewMode("floor"); break;
      case "28": state.floorConfigMode = true; setViewMode("floor"); break;
      case "29": CURRENT_USER.roleKey = "mesero"; renderUserChip(); openAccountPanel("mesa-3"); openDiscountModal("mesa-3"); break;
      case "30": renderInsightBanner(); break;
      default: break;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
