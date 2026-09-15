/* ============================================================================
   TRIDENTPOS — UI Preview V3 — Visual System Reskin
   PREVIEW_FIXTURE_DATA / PREVIEW_UI_PREFERENCE
   V3 is a VISUAL RESKIN ONLY — this file's UX logic is unchanged from V2
   except where explicitly noted (product card markup for imagery, and two
   new dev-only preview scenes: dashboard, design-system).
   ----------------------------------------------------------------------------
   Todo el estado de esta aplicación vive únicamente en memoria/localStorage
   del navegador. No hay red, no hay backend, no hay PostgreSQL/SQLite.
   Los cálculos de IVA/Total son aritmética de presentación (2 decimales) para
   fines de maqueta visual — NO son el motor financiero autoritativo de
   TRIDENTPOS (ver ADR-012, roundDiv, Money en bigint scale4).
   El selector de modificadores es únicamente una demostración UX: no fija
   reglas canónicas ni resuelve OQ-SSOT-07 (ModifierRecipeResolver).
   El único dato persistido en localStorage es la preferencia visual del
   sidebar (expandido/colapsado) — no es una preferencia de usuario real.
   ============================================================================ */

(function () {
  "use strict";

  var TAX_RATE = 0.16;
  var SIDEBAR_PREF_KEY = "tridentpos_preview_sidebar_v1"; // PREVIEW_UI_PREFERENCE

  /* ---------------------------------------------------------------------
     FIXTURE DATA — PREVIEW_FIXTURE_DATA
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

  /**
   * Modifier demo — UX PREVIEW ONLY. Deliberately limited to one product
   * family so this stays a demonstration, not a canonical modifier engine.
   */
  var MODIFIER_PRODUCTS = {
    p06: {
      groups: [
        {
          key: "termino",
          label: "Término",
          type: "radio",
          options: [
            { id: "medio", label: "Medio" },
            { id: "34", label: "3/4" },
            { id: "bien", label: "Bien cocido" }
          ]
        },
        {
          key: "extras",
          label: "Extras",
          type: "checkbox",
          kind: "add",
          options: [
            { id: "aguacate", label: "Aguacate" },
            { id: "queso", label: "Queso" }
          ]
        },
        {
          key: "quitar",
          label: "Quitar",
          type: "checkbox",
          kind: "remove",
          options: [{ id: "cebolla", label: "Sin cebolla" }]
        }
      ]
    }
  };

  function minutesAgo(min) {
    return Date.now() - min * 60 * 1000;
  }

  function lineSubtotal(line) {
    return line.qty * line.unitPrice;
  }

  function accountSubtotal(account) {
    if (!account) return 0;
    return account.lines.reduce(function (sum, l) { return sum + lineSubtotal(l); }, 0);
  }

  var TABLES = [
    // Salón Principal
    tbl(1, "Salón Principal", 4, "disponible"),
    tbl(2, "Salón Principal", 2, "disponible"),
    tbl(
      3,
      "Salón Principal",
      4,
      "ocupada",
      "Carlos M.",
      minutesAgo(38),
      [
        { id: "l1", name: "Taco Rib Eye", qty: 2, unitPrice: 148, mods: [{ t: "remove", label: "Sin cebolla" }, { t: "add", label: "Aguacate" }] },
        { id: "l2", name: "Agua Mineral", qty: 1, unitPrice: 45, mods: [] },
        { id: "l3", name: "Cheesecake de Frutos Rojos", qty: 1, unitPrice: 95, mods: [] }
      ]
    ),
    tbl(4, "Salón Principal", 6, "disponible"),
    tbl(
      5,
      "Salón Principal",
      4,
      "ocupada",
      "Ana R.",
      minutesAgo(8),
      [
        { id: "l1", name: "Guacamole en Molcajete", qty: 1, unitPrice: 165, mods: [] },
        { id: "l2", name: "Michelada", qty: 1, unitPrice: 95, mods: [] }
      ]
    ),
    tbl(6, "Salón Principal", 2, "disponible"),

    // Terraza
    tbl(
      7,
      "Terraza",
      2,
      "ocupada",
      "Ana R.",
      minutesAgo(15),
      [
        { id: "l1", name: "Aguachile Verde", qty: 1, unitPrice: 195, mods: [] },
        { id: "l2", name: "Cerveza Artesanal", qty: 2, unitPrice: 85, mods: [] }
      ]
    ),
    tbl(8, "Terraza", 2, "disponible"),
    tbl(9, "Terraza", 4, "disponible"),
    tbl(10, "Terraza", 4, "disponible"),
    tbl(
      11,
      "Terraza",
      6,
      "atencion",
      "Luis P.",
      minutesAgo(52),
      [
        { id: "l1", name: "Arrachera a la Parrilla", qty: 3, unitPrice: 385, mods: [{ t: "add", label: "Término medio" }] },
        { id: "l2", name: "Margarita Tamarindo", qty: 4, unitPrice: 135, mods: [] },
        { id: "l3", name: "Queso Fundido con Chorizo", qty: 2, unitPrice: 155, mods: [] }
      ]
    ),
    tbl(12, "Terraza", 4, "disponible"),

    // Barra
    tbl(13, "Barra", 2, "disponible"),
    tbl(
      14,
      "Barra",
      2,
      "por_cobrar",
      "Sofía G.",
      minutesAgo(64),
      [
        { id: "l1", name: "Taco Al Pastor", qty: 6, unitPrice: 42, mods: [] },
        { id: "l2", name: "Cerveza Artesanal", qty: 3, unitPrice: 85, mods: [] }
      ]
    ),
    tbl(15, "Barra", 2, "disponible"),
    tbl(16, "Barra", 4, "disponible"),

    // Privado
    tbl(17, "Privado", 8, "disponible"),
    tbl(
      18,
      "Privado",
      8,
      "ocupada",
      "Diego H.",
      minutesAgo(22),
      [
        { id: "l1", name: "Filete de Salmón", qty: 4, unitPrice: 345, mods: [] },
        { id: "l2", name: "Costillas BBQ", qty: 3, unitPrice: 320, mods: [{ t: "remove", label: "Sin salsa BBQ" }] },
        { id: "l3", name: "Margarita Tamarindo", qty: 6, unitPrice: 135, mods: [] },
        { id: "l4", name: "Pastel de Chocolate", qty: 4, unitPrice: 105, mods: [] }
      ]
    ),
    tbl(19, "Privado", 6, "disponible"),
    tbl(20, "Privado", 10, "disponible")
  ];

  function tbl(number, zone, capacity, status, waiter, openedAt, lines) {
    var t = {
      id: "mesa-" + number,
      number: number,
      zone: zone,
      capacity: capacity,
      status: status,
      waiter: waiter || null,
      account: null
    };
    if (status !== "disponible") {
      t.account = {
        folio: "F-" + String(1000 + number),
        openedAt: openedAt,
        waiter: waiter,
        lines: lines || []
      };
    }
    return t;
  }

  /* ---------------------------------------------------------------------
     STATE
     --------------------------------------------------------------------- */

  var state = {
    zone: "todos",
    activeTableId: null,
    posCategory: "Favoritos",
    posSearch: "",
    posTicket: [], // { lineId, productId, qty, modsKey, modsLabel }
    modifier: null // { productId, selections } while modal is open
  };

  var lineIdCounter = 0;
  function nextLineId() {
    lineIdCounter += 1;
    return "tl" + lineIdCounter;
  }

  /* ---------------------------------------------------------------------
     HELPERS
     --------------------------------------------------------------------- */

  function fmtMoney(n) {
    return (
      "$" +
      n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  }

  function elapsedLabel(ts) {
    var min = Math.max(0, Math.round((Date.now() - ts) / 60000));
    return min + " min";
  }

  function findTable(id) {
    for (var i = 0; i < TABLES.length; i++) {
      if (TABLES[i].id === id) return TABLES[i];
    }
    return null;
  }

  function statusLabel(status) {
    return (
      {
        disponible: "Disponible",
        ocupada: "Ocupada",
        atencion: "Atención",
        por_cobrar: "Por cobrar"
      }[status] || status
    );
  }

  function statusIcon(status) {
    switch (status) {
      case "disponible":
        return '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
      case "ocupada":
        return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
      case "atencion":
        return '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a1.5 1.5 0 0 0 1.3 2.3h17.8a1.5 1.5 0 0 0 1.3-2.3L13.7 3.9a1.5 1.5 0 0 0-2.6 0Z"/></svg>';
      case "por_cobrar":
        return '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';
      default:
        return "";
    }
  }

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
    toast._t = setTimeout(function () {
      el.classList.remove("visible");
    }, 2200);
  }

  /* ---------------------------------------------------------------------
     SIDEBAR — expand / collapse — PREVIEW_UI_PREFERENCE
     --------------------------------------------------------------------- */

  function readSidebarPreference() {
    try {
      return window.localStorage.getItem(SIDEBAR_PREF_KEY);
    } catch (e) {
      return null; // localStorage unavailable (private mode, etc.) — fail soft
    }
  }

  function writeSidebarPreference(value) {
    try {
      window.localStorage.setItem(SIDEBAR_PREF_KEY, value);
    } catch (e) {
      // Ignore — this is a cosmetic preview preference, not business state.
    }
  }

  function applySidebarState(collapsed) {
    var sidebar = document.getElementById("sidebar");
    sidebar.classList.toggle("collapsed", collapsed);
    var toggle = document.getElementById("sidebar-toggle");
    toggle.setAttribute("data-tooltip", collapsed ? "Expandir" : "Colapsar");
    toggle.querySelector(".nav-label").textContent = collapsed ? "Expandir" : "Colapsar";
  }

  function initSidebar() {
    var stored = readSidebarPreference();
    var collapsed;
    if (stored === "collapsed" || stored === "expanded") {
      collapsed = stored === "collapsed";
    } else {
      // No stored preference yet: default by viewport, per spec section 7.
      collapsed = window.innerWidth <= 1280;
    }
    applySidebarState(collapsed);

    document.getElementById("sidebar-toggle").addEventListener("click", function () {
      var isCollapsed = document.getElementById("sidebar").classList.contains("collapsed");
      var next = !isCollapsed;
      applySidebarState(next);
      writeSidebarPreference(next ? "collapsed" : "expanded");
    });
  }

  /* ---------------------------------------------------------------------
     RENDER: SALÓN / TABLES GRID
     --------------------------------------------------------------------- */

  function renderTablesGrid() {
    var grid = document.getElementById("tables-grid");
    var visible = TABLES.filter(function (t) {
      return state.zone === "todos" || t.zone === state.zone;
    });

    grid.innerHTML = visible
      .map(function (t) {
        var isAvailable = t.status === "disponible";
        var total = t.account ? accountSubtotal(t.account) * (1 + TAX_RATE) : 0;

        var timeBlock = "";
        var waiterBlock = "";
        var bottomBlock = "";

        if (isAvailable) {
          timeBlock = '<div class="table-available-label">Lista para recibir</div>';
        } else {
          var mins = Math.max(0, Math.round((Date.now() - t.account.openedAt) / 60000));
          var timeClass = mins >= 60 ? " time-critical" : mins >= 45 ? " time-warn" : "";
          waiterBlock = '<div class="table-waiter">' + escapeHtml(t.waiter) + "</div>";
          timeBlock =
            '<div class="table-time' +
            timeClass +
            '"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>' +
            elapsedLabel(t.account.openedAt) +
            "</div>";
          bottomBlock =
            '<div class="table-card-bottom"><span class="table-total">' +
            fmtMoney(total) +
            "</span>" +
            (t.status === "atencion"
              ? '<span class="table-attention-flag">' + statusIcon("atencion") + "Requiere atención</span>"
              : "") +
            "</div>";
        }

        var selected = t.id === state.activeTableId ? " selected" : "";

        return (
          '<button class="table-card status-' +
          t.status +
          selected +
          '" data-table-id="' +
          t.id +
          '">' +
          '<div class="table-card-top">' +
          '<div><div class="table-number">Mesa ' +
          String(t.number).padStart(2, "0") +
          '</div><div class="table-capacity"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>' +
          t.capacity +
          " personas</div></div>" +
          '<span class="status-badge status-' +
          t.status +
          '">' +
          statusIcon(t.status) +
          statusLabel(t.status) +
          "</span>" +
          "</div>" +
          '<div class="table-card-mid">' +
          waiterBlock +
          timeBlock +
          "</div>" +
          bottomBlock +
          "</button>"
        );
      })
      .join("");

    var openCount = TABLES.filter(function (t) { return t.account; }).length;
    document.getElementById("salon-subtitle").textContent =
      TABLES.length + " mesas · " + openCount + " cuentas abiertas";

    Array.prototype.forEach.call(grid.querySelectorAll(".table-card"), function (card) {
      card.addEventListener("click", function () {
        openAccountPanel(card.getAttribute("data-table-id"));
      });
    });
  }

  /* ---------------------------------------------------------------------
     ACCOUNT PANEL
     --------------------------------------------------------------------- */

  function openAccountPanel(tableId) {
    state.activeTableId = tableId;
    renderAccountPanel();
    renderTablesGrid(); // reflect .selected state on the floor behind the drawer
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

    document.getElementById("account-title").textContent =
      "Mesa " + String(t.number).padStart(2, "0");

    var metaEl = document.getElementById("account-meta");
    var bodyEl = document.getElementById("account-panel-body");
    var actionsEl = document.getElementById("account-actions");
    var summaryEl = document.getElementById("account-summary");

    if (!t.account) {
      metaEl.innerHTML =
        metaItem("Zona", t.zone) +
        metaItem("Capacidad", t.capacity + " personas") +
        metaItem("Estado", statusLabel(t.status));
      bodyEl.innerHTML =
        '<div class="ticket-empty" style="padding-top:40px">Esta mesa está disponible. Aún no tiene una cuenta abierta.</div>';
      summaryEl.style.display = "none";
      actionsEl.innerHTML =
        '<button class="btn-action btn-primary" data-toast="Abrir mesa" style="grid-column:1/-1">' +
        '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Abrir mesa</button>';
      bindToastButtons(actionsEl);
      return;
    }

    summaryEl.style.display = "";
    metaEl.innerHTML =
      metaItem("Mesero", t.waiter) +
      metaItem("Personas", t.capacity) +
      metaItem("Tiempo", elapsedLabel(t.account.openedAt)) +
      metaItem("Folio", t.account.folio) +
      metaItem("Estado", statusLabel(t.status));

    var linesCountLabel =
      "(" + t.account.lines.length + (t.account.lines.length === 1 ? " partida)" : " partidas)");

    bodyEl.innerHTML =
      '<div class="account-section"><h3>Partidas <span class="order-lines-count">' +
      linesCountLabel +
      '</span></h3><div class="order-lines" id="order-lines">' +
      t.account.lines
        .map(function (line) {
          var mods = line.mods
            .map(function (m) {
              return '<span class="mod-' + m.t + '">' + escapeHtml(m.label) + "</span>";
            })
            .join("");
          return (
            '<div class="order-line"><div class="order-line-qty">' +
            line.qty +
            '×</div><div class="order-line-body"><div class="order-line-name"><span>' +
            escapeHtml(line.name) +
            '</span><span class="order-line-subtotal">' +
            fmtMoney(lineSubtotal(line)) +
            "</span></div>" +
            (mods ? '<div class="order-line-mods">' + mods + "</div>" : "") +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>";

    var subtotal = accountSubtotal(t.account);
    var total = subtotal * (1 + TAX_RATE);
    var tax = total - subtotal;

    document.getElementById("account-subtotal").textContent = fmtMoney(subtotal);
    document.getElementById("account-tax").textContent = fmtMoney(tax);
    document.getElementById("account-total").textContent = fmtMoney(total);

    actionsEl.innerHTML =
      '<button class="btn-action btn-primary" id="btn-add-products">' +
      '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Agregar productos</button>' +
      '<button class="btn-action" data-toast="Enviar a cocina"><svg viewBox="0 0 24 24"><path d="M4 15h16M8 15V6a4 4 0 0 1 8 0v9M6 15l1 5h10l1-5"/></svg>Enviar a cocina</button>' +
      '<button class="btn-action" data-toast="Mover mesa"><svg viewBox="0 0 24 24"><path d="M7 7 3 12l4 5M17 7l4 5-4 5M3 12h18"/></svg>Mover mesa</button>' +
      '<button class="btn-action" data-toast="Dividir cuenta"><svg viewBox="0 0 24 24"><path d="M12 3v18M5 8h4M15 8h4M5 16h4M15 16h4"/></svg>Dividir cuenta</button>' +
      '<button class="btn-action" data-toast="Imprimir"><svg viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/></svg>Imprimir</button>' +
      '<button class="btn-action btn-cobrar" data-toast="Cobrar"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2.5-5 1.5-5 4a2.5 2.5 0 0 0 5 0M12 6.5v11"/></svg>Cobrar</button>';

    document.getElementById("btn-add-products").addEventListener("click", function () {
      enterPosMode(t);
    });
    bindToastButtons(actionsEl);
  }

  function metaItem(label, value) {
    return (
      '<div class="meta-item"><span class="meta-label">' +
      escapeHtml(label) +
      '</span><span class="meta-value">' +
      escapeHtml(String(value)) +
      "</span></div>"
    );
  }

  function bindToastButtons(container) {
    Array.prototype.forEach.call(container.querySelectorAll("[data-toast]"), function (btn) {
      btn.addEventListener("click", function () {
        toast(btn.getAttribute("data-toast") + " — vista previa visual, sin lógica de negocio");
      });
    });
  }

  /* ---------------------------------------------------------------------
     POS / PRODUCT SELECTOR
     --------------------------------------------------------------------- */

  function enterPosMode(table) {
    state.posTicket = [];
    state.posCategory = "Favoritos";
    state.posSearch = "";
    document.getElementById("product-search").value = "";
    closeAccountPanel();
    switchView("pos");
    document.getElementById("pos-context-label").textContent =
      "Mesa " + String(table.number).padStart(2, "0") + " · " + table.waiter;
    state.activeTableId = table.id; // keep context without opening the drawer
    renderCategoryTabs();
    renderProductGrid();
    renderTicket();
  }

  function exitPosMode(reopenAccount) {
    switchView("salon");
    closeModifierModal();
    if (reopenAccount && state.activeTableId) {
      openAccountPanel(state.activeTableId);
    } else {
      state.activeTableId = null;
    }
  }

  function switchView(name) {
    Array.prototype.forEach.call(document.querySelectorAll(".view"), function (v) {
      v.classList.remove("active");
    });
    document.getElementById("view-" + name).classList.add("active");
    // "pos" (product selector) is a sub-mode of "salon", not a separate
    // top-level section, so it keeps the Salón sidebar item highlighted.
    var navName = name === "pos" ? "salon" : name;
    Array.prototype.forEach.call(document.querySelectorAll(".nav-item[data-nav]"), function (n) {
      n.classList.toggle("active", n.getAttribute("data-nav") === navName);
    });
  }

  function renderCategoryTabs() {
    var el = document.getElementById("category-tabs");
    var favIcon = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2l-5-4.9 6.9-1L12 2z"/></svg>';

    var chips = ['<button class="chip chip-favorite' +
      (state.posCategory === "Favoritos" ? " active" : "") +
      '" data-cat="Favoritos">' + favIcon + "Favoritos</button>"];

    CATEGORIES.forEach(function (c) {
      chips.push(
        '<button class="chip' +
        (c === state.posCategory ? " active" : "") +
        '" data-cat="' +
        c +
        '">' +
        c +
        "</button>"
      );
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

  var PRODUCT_ICONS = {
    Entradas: "🥑",
    Tacos: "🌮",
    Platos: "🍽️",
    Bebidas: "🥤",
    Postres: "🍰"
  };

  function currentProductQtyInTicket(productId) {
    return state.posTicket
      .filter(function (l) { return l.productId === productId; })
      .reduce(function (s, l) { return s + l.qty; }, 0);
  }

  function visibleProducts() {
    var q = state.posSearch.trim().toLowerCase();
    if (q) {
      return MENU.filter(function (p) {
        return p.name.toLowerCase().indexOf(q) !== -1 || p.cat.toLowerCase().indexOf(q) !== -1;
      });
    }
    if (state.posCategory === "Favoritos") {
      return FAVORITE_IDS.map(function (id) { return MENU.find(function (m) { return m.id === id; }); });
    }
    return MENU.filter(function (p) { return p.cat === state.posCategory; });
  }

  function renderProductGrid() {
    var grid = document.getElementById("product-grid");
    var items = visibleProducts();

    if (items.length === 0) {
      grid.innerHTML = '<div class="pos-search-empty">Sin resultados para tu búsqueda.</div>';
      return;
    }

    grid.innerHTML = items
      .map(function (p) {
        var qty = currentProductQtyInTicket(p.id);
        var badge = qty > 0 ? '<span class="product-card-qty-badge">' + qty + "</span>" : "";
        var desc = p.desc ? '<div class="product-desc">' + escapeHtml(p.desc) + "</div>" : "";
        return (
          '<button class="product-card" data-product-id="' +
          p.id +
          '">' +
          badge +
          '<span class="product-card-plus1" id="plus1-' +
          p.id +
          '">+1</span>' +
          '<div class="product-thumb cat-' +
          p.cat +
          '">' +
          PRODUCT_ICONS[p.cat] +
          '</div><div class="product-card-body"><div class="product-name">' +
          escapeHtml(p.name) +
          "</div>" +
          desc +
          '<div class="product-price">' +
          fmtMoney(p.price) +
          "</div></div></button>"
        );
      })
      .join("");

    Array.prototype.forEach.call(grid.querySelectorAll(".product-card"), function (card) {
      card.addEventListener("click", function () {
        var pid = card.getAttribute("data-product-id");
        productCardFeedback(card, pid);
        if (MODIFIER_PRODUCTS[pid]) {
          openModifierModal(pid);
        } else {
          addPlainToTicket(pid);
        }
      });
    });
  }

  function productCardFeedback(card, productId) {
    card.classList.remove("pulse");
    // Force reflow so the animation can restart on rapid repeat clicks.
    void card.offsetWidth;
    card.classList.add("pulse");

    var plus1 = document.getElementById("plus1-" + productId);
    if (plus1) {
      plus1.classList.remove("show");
      void plus1.offsetWidth;
      plus1.classList.add("show");
    }
  }

  /* ---------------------------------------------------------------------
     TICKET — line model: { lineId, productId, qty, modsKey, modsLabel }
     --------------------------------------------------------------------- */

  function addPlainToTicket(productId) {
    var existing = state.posTicket.find(function (l) {
      return l.productId === productId && l.modsKey === "";
    });
    if (existing) {
      existing.qty += 1;
    } else {
      state.posTicket.push({ lineId: nextLineId(), productId: productId, qty: 1, modsKey: "", modsLabel: [] });
    }
    renderTicket();
    renderProductGrid();
  }

  function addModifiedToTicket(productId, modsKey, modsLabel) {
    var existing = state.posTicket.find(function (l) {
      return l.productId === productId && l.modsKey === modsKey;
    });
    if (existing) {
      existing.qty += 1;
    } else {
      state.posTicket.push({
        lineId: nextLineId(),
        productId: productId,
        qty: 1,
        modsKey: modsKey,
        modsLabel: modsLabel
      });
    }
    renderTicket();
    renderProductGrid();
  }

  function changeTicketQty(lineId, delta) {
    var line = state.posTicket.find(function (l) { return l.lineId === lineId; });
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) {
      state.posTicket = state.posTicket.filter(function (l) { return l.lineId !== lineId; });
    }
    renderTicket();
    renderProductGrid();
  }

  function removeTicketLine(lineId) {
    state.posTicket = state.posTicket.filter(function (l) { return l.lineId !== lineId; });
    renderTicket();
    renderProductGrid();
  }

  function renderTicket() {
    var itemsEl = document.getElementById("ticket-items");

    if (state.posTicket.length === 0) {
      itemsEl.innerHTML =
        '<div class="ticket-empty" id="ticket-empty">Selecciona productos del menú para agregarlos al ticket.</div>';
    } else {
      itemsEl.innerHTML = state.posTicket
        .map(function (line) {
          var p = MENU.find(function (m) { return m.id === line.productId; });
          var modsHtml = line.modsLabel.length
            ? '<div class="ticket-line-mods">' +
              line.modsLabel.map(function (m) { return escapeHtml(m); }).join(" · ") +
              "</div>"
            : "";
          return (
            '<div class="ticket-line" data-line-id="' +
            line.lineId +
            '">' +
            '<div class="qty-stepper"><button data-action="dec">−</button><span>' +
            line.qty +
            '</span><button data-action="inc">+</button></div>' +
            '<div class="ticket-line-body"><div class="ticket-line-name">' +
            escapeHtml(p.name) +
            '</div><div class="ticket-line-price">' +
            fmtMoney(p.price) +
            " c/u</div>" +
            modsHtml +
            "</div>" +
            '<div class="ticket-line-subtotal">' +
            fmtMoney(p.price * line.qty) +
            "</div>" +
            '<button class="ticket-line-remove" data-action="remove" title="Quitar"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
            "</div>"
          );
        })
        .join("");

      Array.prototype.forEach.call(itemsEl.querySelectorAll(".ticket-line"), function (row) {
        var lid = row.getAttribute("data-line-id");
        row.querySelector('[data-action="inc"]').addEventListener("click", function () {
          changeTicketQty(lid, 1);
        });
        row.querySelector('[data-action="dec"]').addEventListener("click", function () {
          changeTicketQty(lid, -1);
        });
        row.querySelector('[data-action="remove"]').addEventListener("click", function () {
          removeTicketLine(lid);
        });
      });
    }

    var totalQty = state.posTicket.reduce(function (s, l) { return s + l.qty; }, 0);
    document.getElementById("ticket-count").textContent =
      totalQty + (totalQty === 1 ? " producto" : " productos");

    var subtotal = state.posTicket.reduce(function (s, l) {
      var p = MENU.find(function (m) { return m.id === l.productId; });
      return s + p.price * l.qty;
    }, 0);
    var tax = subtotal * TAX_RATE;
    var total = subtotal + tax;

    document.getElementById("ticket-subtotal").textContent = fmtMoney(subtotal);
    document.getElementById("ticket-tax").textContent = fmtMoney(tax);
    document.getElementById("ticket-total").textContent = fmtMoney(total);

    document.getElementById("btn-add-to-account").disabled = state.posTicket.length === 0;
  }

  function commitTicketToAccount() {
    var t = findTable(state.activeTableId);
    if (!t || state.posTicket.length === 0) return;

    if (!t.account) {
      t.status = "ocupada";
      t.waiter = "Carlos Mendoza";
      t.account = { folio: "F-" + String(1000 + t.number), openedAt: Date.now(), waiter: t.waiter, lines: [] };
    }

    state.posTicket.forEach(function (line) {
      var p = MENU.find(function (m) { return m.id === line.productId; });
      var mods = line.modsLabel.map(function (label) {
        // Removal-style labels start with "Sin " by convention in this fixture set.
        return { t: /^sin\s/i.test(label) ? "remove" : "add", label: label };
      });
      t.account.lines.push({
        id: "l" + Date.now() + Math.random().toString(16).slice(2, 6),
        name: p.name,
        qty: line.qty,
        unitPrice: p.price,
        mods: mods
      });
    });

    state.posTicket = [];
    toast("Productos agregados a la cuenta");
    exitPosMode(true);
    renderTablesGrid();
  }

  /* ---------------------------------------------------------------------
     MODIFIER MODAL — UX PREVIEW ONLY
     --------------------------------------------------------------------- */

  function openModifierModal(productId) {
    var p = MENU.find(function (m) { return m.id === productId; });
    var def = MODIFIER_PRODUCTS[productId];
    if (!p || !def) return;

    var selections = {};
    def.groups.forEach(function (g) {
      selections[g.key] = g.type === "radio" ? g.options[0].id : [];
    });
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

    body.innerHTML = def.groups
      .map(function (g) {
        var options = g.options
          .map(function (opt) {
            var inputType = g.type === "radio" ? "radio" : "checkbox";
            var name = "modgroup-" + g.key;
            var checked =
              g.type === "radio"
                ? state.modifier.selections[g.key] === opt.id
                : state.modifier.selections[g.key].indexOf(opt.id) !== -1;
            return (
              '<div class="modifier-option"><input type="' +
              inputType +
              '" id="modopt-' +
              opt.id +
              '" name="' +
              name +
              '" data-group="' +
              g.key +
              '" data-option="' +
              opt.id +
              '"' +
              (checked ? " checked" : "") +
              ' /><label for="modopt-' +
              opt.id +
              '">' +
              escapeHtml(opt.label) +
              "</label></div>"
            );
          })
          .join("");
        return '<div class="modifier-group"><h4>' + escapeHtml(g.label) + "</h4>" + options + "</div>";
      })
      .join("");

    Array.prototype.forEach.call(body.querySelectorAll("input"), function (input) {
      input.addEventListener("change", function () {
        var groupKey = input.getAttribute("data-group");
        var optionId = input.getAttribute("data-option");
        var group = def.groups.find(function (g) { return g.key === groupKey; });
        if (group.type === "radio") {
          state.modifier.selections[groupKey] = optionId;
        } else {
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

    var labels = [];
    var keyParts = [];
    def.groups.forEach(function (g) {
      if (g.type === "radio") {
        var opt = g.options.find(function (o) { return o.id === selections[g.key]; });
        if (opt) {
          labels.push(opt.label);
          keyParts.push(g.key + ":" + opt.id);
        }
      } else {
        var ids = selections[g.key].slice().sort();
        ids.forEach(function (id) {
          var o = g.options.find(function (x) { return x.id === id; });
          if (o) labels.push(g.kind === "remove" ? "Sin " + o.label : o.label);
        });
        keyParts.push(g.key + ":" + ids.join(","));
      }
    });

    addModifiedToTicket(productId, keyParts.join("|"), labels);
    closeModifierModal();

    var p = MENU.find(function (m) { return m.id === productId; });
    toast("Agregado: " + p.name + (labels.length ? " (" + labels.join(", ") + ")" : ""));
  }

  /* ---------------------------------------------------------------------
     SEARCH
     --------------------------------------------------------------------- */

  function initSearch() {
    var input = document.getElementById("product-search");
    input.addEventListener("input", function () {
      state.posSearch = input.value;
      if (state.posSearch.trim()) {
        Array.prototype.forEach.call(document.querySelectorAll("#category-tabs .chip"), function (c) {
          c.classList.remove("active");
        });
      } else {
        renderCategoryTabs();
      }
      renderProductGrid();
    });
  }

  /* ---------------------------------------------------------------------
     KEYBOARD SHORTCUTS — preview only
     --------------------------------------------------------------------- */

  function initKeyboard() {
    document.addEventListener("keydown", function (e) {
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      var typing = tag === "INPUT" || tag === "TEXTAREA";

      var isCmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      var isSlash = e.key === "/" && !typing;

      if ((isCmdK || isSlash) && document.getElementById("view-pos").classList.contains("active")) {
        e.preventDefault();
        document.getElementById("product-search").focus();
        return;
      }

      if (e.key === "Escape") {
        if (document.getElementById("modifier-modal").classList.contains("open")) {
          closeModifierModal();
          return;
        }
        if (document.getElementById("account-panel").classList.contains("open")) {
          closeAccountPanel();
        }
      }
    });
  }

  /* ---------------------------------------------------------------------
     DASHBOARD — CONCEPT PREVIEW ONLY (section 26)
     Fixture-only illustration of the future dashboard visual language.
     Not a functional module, not reachable from the sidebar nav.
     --------------------------------------------------------------------- */

  function gaugeSvg(pct, color) {
    var r = 22;
    var c = 2 * Math.PI * r;
    var offset = c * (1 - pct / 100);
    return (
      '<svg class="gauge-ring" width="56" height="56" viewBox="0 0 56 56">' +
      '<circle cx="28" cy="28" r="' + r + '" fill="none" stroke="var(--surface-muted)" stroke-width="6"/>' +
      '<circle cx="28" cy="28" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="6" ' +
      'stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + offset + '" ' +
      'transform="rotate(-90 28 28)"/>' +
      '</svg>'
    );
  }

  function renderDashboardPreview() {
    var el = document.getElementById("dashboard-grid");
    if (!el) return;

    var kpis = [
      { label: "Mesas ocupadas", value: "12 / 40", trend: "+3 vs. ayer", dir: "up" },
      { label: "Ventas del día", value: "$18,423", trend: "+8.4%", dir: "up" },
      { label: "Órdenes activas", value: "34", trend: "sin cambio", dir: "flat" },
      { label: "Ticket promedio", value: "$542", trend: "-2.1%", dir: "down" }
    ];

    var kpiHtml = kpis
      .map(function (k) {
        return (
          '<div class="kpi-card"><span class="kpi-label">' + escapeHtml(k.label) + "</span>" +
          '<span class="kpi-value">' + escapeHtml(k.value) + "</span>" +
          '<span class="kpi-trend ' + k.dir + '">' + escapeHtml(k.trend) + "</span></div>"
        );
      })
      .join("");

    var insights = [
      { title: "Cocina", value: "14 preparando", pct: 58, color: "var(--status-warning)" },
      { title: "Mesas", value: "7 ocupadas de 20", pct: 35, color: "var(--status-info)" },
      { title: "Ventas vs. meta", value: "65% de la meta diaria", pct: 65, color: "var(--status-success)" }
    ];

    var insightsHtml = insights
      .map(function (i) {
        return (
          '<div class="insight-row">' + gaugeSvg(i.pct, i.color) +
          '<div class="insight-body"><div class="insight-title">' + escapeHtml(i.title) + "</div>" +
          '<div class="insight-value">' + escapeHtml(i.value) + "</div></div></div>"
        );
      })
      .join("");

    var feed = [
      { dot: "attention", title: "Mesa 7", sub: "Mesero solicitado", time: "hace 1 min" },
      { dot: "success", title: "KDS", sub: "Orden #12 lista", time: "hace 3 min" },
      { dot: "warning", title: "Mesa 12", sub: "Cuenta por cobrar", time: "hace 6 min" },
      { dot: "info", title: "Mesa 5", sub: "Productos agregados a la cuenta", time: "hace 9 min" }
    ];

    var feedHtml = feed
      .map(function (f) {
        return (
          '<div class="feed-item"><span class="feed-dot ' + f.dot + '"></span>' +
          '<div class="insight-body"><div class="feed-title">' + escapeHtml(f.title) + "</div>" +
          '<div class="feed-sub">' + escapeHtml(f.sub) + "</div></div>" +
          '<span class="feed-time">' + escapeHtml(f.time) + "</span></div>"
        );
      })
      .join("");

    el.innerHTML =
      '<div class="kpi-row">' + kpiHtml + "</div>" +
      '<div class="dashboard-columns">' +
      '<div class="panel-card"><h3>Operational Feed</h3><div class="feed-list">' + feedHtml + "</div></div>" +
      '<div class="panel-card"><h3>Quick Insights</h3>' + insightsHtml + "</div>" +
      "</div>";
  }

  /* ---------------------------------------------------------------------
     DESIGN SYSTEM — COMPONENT OVERVIEW (dev-only reference, section 29)
     --------------------------------------------------------------------- */

  function renderDesignSystemOverview() {
    var el = document.getElementById("ds-grid");
    if (!el) return;

    var colors = [
      ["Graphite (action-primary)", "var(--gray-900)"],
      ["Warm White (surface-page)", "var(--surface-page)"],
      ["Off White (surface-muted)", "var(--surface-muted)"],
      ["Success", "var(--status-success)"],
      ["Warning", "var(--status-warning)"],
      ["Attention", "var(--status-attention)"],
      ["Info", "var(--status-info)"]
    ];

    var colorHtml = colors
      .map(function (c) {
        return (
          '<div class="ds-swatch"><div class="ds-swatch-color" style="background:' + c[1] +
          '"></div><span class="ds-swatch-label">' + escapeHtml(c[0]) + "</span></div>"
        );
      })
      .join("");

    var radii = [
      ["sm 10px", "var(--radius-sm)"],
      ["md 16px", "var(--radius-md)"],
      ["lg 22px", "var(--radius-lg)"],
      ["xl 28px", "var(--radius-xl)"]
    ];
    var radiusHtml = radii
      .map(function (r) {
        return '<div class="ds-radius-demo" style="border-radius:' + r[1] + '">' + r[0] + "</div>";
      })
      .join("");

    var buttonsHtml =
      '<button class="btn-primary" style="padding:12px 22px;">Cobrar</button>' +
      '<button class="btn-secondary" style="max-width:140px;padding:12px 22px;">Cancelar</button>' +
      '<button class="chip active">Categoría activa</button>' +
      '<button class="chip">Categoría</button>' +
      '<button class="icon-btn"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/></svg></button>' +
      '<span class="status-badge status-disponible">Disponible</span>' +
      '<span class="status-badge status-ocupada">Ocupada</span>' +
      '<span class="status-badge status-atencion">Atención</span>' +
      '<span class="status-badge status-por_cobrar">Por cobrar</span>';

    el.innerHTML =
      '<div class="ds-section"><h3>Color</h3><div class="ds-row">' + colorHtml + "</div></div>" +
      '<div class="ds-section"><h3>Radius</h3><div class="ds-row">' + radiusHtml + "</div></div>" +
      '<div class="ds-section"><h3>Buttons · Badges · Chips</h3><div class="ds-row">' + buttonsHtml + "</div></div>" +
      '<div class="ds-section"><h3>KPI Card</h3><div class="kpi-row" style="grid-template-columns:repeat(2,minmax(180px,1fr));">' +
      '<div class="kpi-card"><span class="kpi-label">Ventas</span><span class="kpi-value">$18,423</span><span class="kpi-trend up">+8.4%</span></div>' +
      '<div class="kpi-card"><span class="kpi-label">Mesas ocupadas</span><span class="kpi-value">12 / 40</span><span class="kpi-trend flat">sin cambio</span></div>' +
      "</div></div>" +
      '<div class="ds-section"><h3>Gauge</h3><div class="ds-row">' + gaugeSvg(65, "var(--status-success)") + gaugeSvg(35, "var(--status-info)") + "</div></div>" +
      '<div class="ds-section"><h3>Activity Feed Item</h3><div class="feed-list">' +
      '<div class="feed-item"><span class="feed-dot success"></span><div class="insight-body"><div class="feed-title">KDS</div><div class="feed-sub">Orden #12 lista</div></div><span class="feed-time">hace 3 min</span></div>' +
      "</div></div>";
  }

  /* ---------------------------------------------------------------------
     CLOCK
     --------------------------------------------------------------------- */

  function tickClock() {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, "0");
    var m = String(now.getMinutes()).padStart(2, "0");
    document.getElementById("topbar-clock").textContent = h + ":" + m;
  }

  /* ---------------------------------------------------------------------
     WIRE UP
     --------------------------------------------------------------------- */

  function init() {
    initSidebar();
    initSearch();
    initKeyboard();

    // Zone tabs
    Array.prototype.forEach.call(document.querySelectorAll("#zone-tabs .chip"), function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("#zone-tabs .chip").forEach(function (c) {
          c.classList.remove("active");
        });
        chip.classList.add("active");
        state.zone = chip.getAttribute("data-zone");
        renderTablesGrid();
      });
    });

    // Sidebar nav (only Salón is functional; toggle handled separately)
    Array.prototype.forEach.call(document.querySelectorAll(".sidebar .nav-item[data-nav]"), function (item) {
      item.addEventListener("click", function () {
        var target = item.getAttribute("data-nav");
        if (target === "disabled") {
          toast("Módulo en construcción");
          return;
        }
        exitPosMode(false);
        closeAccountPanel();
      });
    });

    document.getElementById("btn-close-panel").addEventListener("click", closeAccountPanel);
    document.getElementById("backdrop").addEventListener("click", closeAccountPanel);
    document.getElementById("btn-back-to-salon").addEventListener("click", function () {
      exitPosMode(true);
    });
    document.getElementById("btn-add-to-account").addEventListener("click", commitTicketToAccount);

    document.getElementById("btn-close-modifier").addEventListener("click", closeModifierModal);
    document.getElementById("btn-modifier-cancel").addEventListener("click", closeModifierModal);
    document.getElementById("btn-modifier-add").addEventListener("click", confirmModifierSelection);
    document.getElementById("modifier-backdrop").addEventListener("click", closeModifierModal);

    renderTablesGrid();
    tickClock();
    setInterval(tickClock, 15000);
    setInterval(renderTablesGrid, 30000); // keep elapsed-time labels fresh

    applyScreenshotScene(); // dev-only helper, see below
  }

  /**
   * Screenshot/demo helper ONLY — lets evidence-capture tooling jump straight
   * to a specific screen via a URL query string, e.g.:
   *   index.html?scene=table&id=mesa-3
   *   index.html?scene=table&id=mesa-18&stress=20
   *   index.html?scene=pos&table=mesa-5&demo=1
   *   index.html?scene=pos&table=mesa-5&modifier=1
   * Not part of the product UX, not linked from anywhere in the UI itself.
   */
  function applyScreenshotScene() {
    var params = new URLSearchParams(window.location.search);
    var scene = params.get("scene");

    var sidebarOverride = params.get("sidebar");
    if (sidebarOverride === "collapsed" || sidebarOverride === "expanded") {
      applySidebarState(sidebarOverride === "collapsed");
    }

    var qaTooltip = params.get("qaTooltip");
    if (qaTooltip) {
      var navBtn = document.querySelector('.nav-item[data-nav="' + qaTooltip + '"]');
      if (navBtn) navBtn.classList.add("qa-force-tooltip");
    }

    if (scene === "table") {
      var id = params.get("id");
      var t = findTable(id);
      if (!t) return;

      var stress = parseInt(params.get("stress") || "0", 10);
      if (stress > 0 && t.account) {
        var sample = MENU.slice(0, 8);
        var i = 0;
        while (t.account.lines.length < stress) {
          var p = sample[i % sample.length];
          t.account.lines.push({
            id: "stress" + i,
            name: p.name,
            qty: 1 + (i % 3),
            unitPrice: p.price,
            mods: []
          });
          i++;
        }
      }
      openAccountPanel(id);
    } else if (scene === "pos") {
      var table = findTable(params.get("table")) || TABLES.find(function (x) { return x.account; });
      state.activeTableId = table.id;
      enterPosMode(table);
      if (params.get("demo") === "1") {
        addPlainToTicket("p06");
        addPlainToTicket("p06");
        addPlainToTicket("p18");
        addPlainToTicket("p24");
      }
      if (params.get("demoLong") === "1") {
        ["p01", "p06", "p07", "p12", "p14", "p18", "p20", "p24", "p26"].forEach(function (id) {
          addPlainToTicket(id);
        });
      }
      if (params.get("modifier") === "1") {
        openModifierModal("p06");
      }
      var searchQuery = params.get("search");
      if (searchQuery) {
        var input = document.getElementById("product-search");
        input.value = searchQuery;
        input.dispatchEvent(new Event("input"));
      }
    } else if (scene === "dashboard") {
      renderDashboardPreview();
      switchView("dashboard");
    } else if (scene === "design-system") {
      renderDesignSystemOverview();
      switchView("design-system");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
