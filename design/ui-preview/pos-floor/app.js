/* ============================================================================
   TRIDENTPOS — UI Preview 01 — Salón / Mesas / Cuenta
   PREVIEW_FIXTURE_DATA
   ----------------------------------------------------------------------------
   Todo el estado de esta aplicación vive únicamente en memoria del navegador.
   No hay persistencia, no hay red, no hay backend, no hay PostgreSQL/SQLite.
   Los cálculos de IVA/Total son aritmética de presentación (2 decimales) para
   fines de maqueta visual — NO son el motor financiero autoritativo de
   TRIDENTPOS (ver ADR-012, roundDiv, Money en bigint scale4).
   ============================================================================ */

(function () {
  "use strict";

  var TAX_RATE = 0.16;

  /* ---------------------------------------------------------------------
     FIXTURE DATA — PREVIEW_FIXTURE_DATA
     --------------------------------------------------------------------- */

  var MENU = [
    { id: "p01", cat: "Entradas", name: "Guacamole en Molcajete", price: 165 },
    { id: "p02", cat: "Entradas", name: "Queso Fundido con Chorizo", price: 155 },
    { id: "p03", cat: "Entradas", name: "Sopa Azteca", price: 120 },
    { id: "p04", cat: "Entradas", name: "Tostadas de Atún", price: 175 },
    { id: "p05", cat: "Entradas", name: "Aguachile Verde", price: 195 },

    { id: "p06", cat: "Tacos", name: "Taco Rib Eye", price: 148 },
    { id: "p07", cat: "Tacos", name: "Taco Al Pastor", price: 42 },
    { id: "p08", cat: "Tacos", name: "Taco de Camarón", price: 68 },
    { id: "p09", cat: "Tacos", name: "Taco de Cochinita", price: 45 },
    { id: "p10", cat: "Tacos", name: "Quesabirria (par)", price: 98 },
    { id: "p11", cat: "Tacos", name: "Taco de Pescado", price: 62 },

    { id: "p12", cat: "Platos", name: "Arrachera a la Parrilla", price: 385 },
    { id: "p13", cat: "Platos", name: "Mixiote de Res", price: 245 },
    { id: "p14", cat: "Platos", name: "Costillas BBQ", price: 320 },
    { id: "p15", cat: "Platos", name: "Enchiladas Suizas", price: 165 },
    { id: "p16", cat: "Platos", name: "Pollo a la Parrilla", price: 210 },
    { id: "p17", cat: "Platos", name: "Filete de Salmón", price: 345 },

    { id: "p18", cat: "Bebidas", name: "Agua Mineral", price: 45 },
    { id: "p19", cat: "Bebidas", name: "Limonada Natural", price: 55 },
    { id: "p20", cat: "Bebidas", name: "Michelada", price: 95 },
    { id: "p21", cat: "Bebidas", name: "Margarita Tamarindo", price: 135 },
    { id: "p22", cat: "Bebidas", name: "Cerveza Artesanal", price: 85 },
    { id: "p23", cat: "Bebidas", name: "Café de Olla", price: 48 },

    { id: "p24", cat: "Postres", name: "Cheesecake de Frutos Rojos", price: 95 },
    { id: "p25", cat: "Postres", name: "Flan Napolitano", price: 75 },
    { id: "p26", cat: "Postres", name: "Churros con Cajeta", price: 85 },
    { id: "p27", cat: "Postres", name: "Pastel de Chocolate", price: 105 },
    { id: "p28", cat: "Postres", name: "Nieve de Garrafa", price: 65 }
  ];

  var CATEGORIES = ["Entradas", "Tacos", "Platos", "Bebidas", "Postres"];

  var ZONES = ["Salón Principal", "Terraza", "Barra", "Privado"];

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

  /**
   * Tables. Only tables with `account` are occupied/atencion/por_cobrar.
   * Every displayed subtotal/IVA/total is derived directly from each
   * account's `lines` — there is no independent override, so the itemized
   * partidas and the financial summary can never disagree.
   */
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
    posCategory: CATEGORIES[0],
    posTicket: [] // { productId, qty }
  };

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
    el.textContent = msg + " — vista previa visual, sin lógica de negocio";
    el.classList.add("visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.remove("visible");
    }, 2200);
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
        var total = t.account
          ? accountSubtotal(t.account) * (1 + TAX_RATE)
          : 0;

        var timeBlock = "";
        var waiterBlock = "";
        var bottomBlock = "";

        if (isAvailable) {
          timeBlock = '<div class="table-available-label">Lista para recibir</div>';
        } else {
          var mins = Math.max(0, Math.round((Date.now() - t.account.openedAt) / 60000));
          var warn = mins >= 45 ? " time-warn" : "";
          waiterBlock = '<div class="table-waiter">' + escapeHtml(t.waiter) + "</div>";
          timeBlock =
            '<div class="table-time' +
            warn +
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

        return (
          '<button class="table-card status-' +
          t.status +
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
    document.getElementById("account-panel").classList.add("open");
    document.getElementById("backdrop").classList.add("visible");
  }

  function closeAccountPanel() {
    document.getElementById("account-panel").classList.remove("open");
    document.getElementById("backdrop").classList.remove("visible");
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

    bodyEl.innerHTML =
      '<div class="account-section"><h3>Partidas</h3><div class="order-lines" id="order-lines">' +
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
        toast(btn.getAttribute("data-toast"));
      });
    });
  }

  /* ---------------------------------------------------------------------
     POS / PRODUCT SELECTOR
     --------------------------------------------------------------------- */

  function enterPosMode(table) {
    state.posTicket = [];
    state.posCategory = CATEGORIES[0];
    closeAccountPanel();
    switchView("pos");
    document.getElementById("pos-context-label").textContent =
      "Mesa " + String(table.number).padStart(2, "0") + " · " + table.waiter;
    renderCategoryTabs();
    renderProductGrid();
    renderTicket();
  }

  function exitPosMode(reopenAccount) {
    switchView("salon");
    if (reopenAccount && state.activeTableId) {
      openAccountPanel(state.activeTableId);
    }
  }

  function switchView(name) {
    Array.prototype.forEach.call(document.querySelectorAll(".view"), function (v) {
      v.classList.remove("active");
    });
    document.getElementById("view-" + name).classList.add("active");
    Array.prototype.forEach.call(document.querySelectorAll(".nav-item"), function (n) {
      n.classList.toggle("active", n.getAttribute("data-nav") === name);
    });
  }

  function renderCategoryTabs() {
    var el = document.getElementById("category-tabs");
    el.innerHTML = CATEGORIES.map(function (c) {
      return (
        '<button class="chip' +
        (c === state.posCategory ? " active" : "") +
        '" data-cat="' +
        c +
        '">' +
        c +
        "</button>"
      );
    }).join("");
    Array.prototype.forEach.call(el.querySelectorAll(".chip"), function (chip) {
      chip.addEventListener("click", function () {
        state.posCategory = chip.getAttribute("data-cat");
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

  function renderProductGrid() {
    var grid = document.getElementById("product-grid");
    var items = MENU.filter(function (p) { return p.cat === state.posCategory; });
    grid.innerHTML = items
      .map(function (p) {
        return (
          '<button class="product-card" data-product-id="' +
          p.id +
          '"><div class="product-thumb">' +
          PRODUCT_ICONS[p.cat] +
          '</div><div class="product-name">' +
          escapeHtml(p.name) +
          '</div><div class="product-price">' +
          fmtMoney(p.price) +
          "</div></button>"
        );
      })
      .join("");
    Array.prototype.forEach.call(grid.querySelectorAll(".product-card"), function (card) {
      card.addEventListener("click", function () {
        addToTicket(card.getAttribute("data-product-id"));
      });
    });
  }

  function addToTicket(productId) {
    var existing = state.posTicket.find(function (l) { return l.productId === productId; });
    if (existing) {
      existing.qty += 1;
    } else {
      state.posTicket.push({ productId: productId, qty: 1 });
    }
    renderTicket();
  }

  function changeTicketQty(productId, delta) {
    var line = state.posTicket.find(function (l) { return l.productId === productId; });
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) {
      state.posTicket = state.posTicket.filter(function (l) { return l.productId !== productId; });
    }
    renderTicket();
  }

  function removeTicketLine(productId) {
    state.posTicket = state.posTicket.filter(function (l) { return l.productId !== productId; });
    renderTicket();
  }

  function renderTicket() {
    var itemsEl = document.getElementById("ticket-items");
    var emptyState = state.posTicket.length === 0;

    if (emptyState) {
      itemsEl.innerHTML =
        '<div class="ticket-empty" id="ticket-empty">Selecciona productos del menú para agregarlos al ticket.</div>';
    } else {
      itemsEl.innerHTML = state.posTicket
        .map(function (line) {
          var p = MENU.find(function (m) { return m.id === line.productId; });
          return (
            '<div class="ticket-line" data-product-id="' +
            p.id +
            '">' +
            '<div class="qty-stepper"><button data-action="dec">−</button><span>' +
            line.qty +
            '</span><button data-action="inc">+</button></div>' +
            '<div class="ticket-line-body"><div class="ticket-line-name">' +
            escapeHtml(p.name) +
            '</div><div class="ticket-line-price">' +
            fmtMoney(p.price) +
            " c/u</div></div>" +
            '<div class="ticket-line-subtotal">' +
            fmtMoney(p.price * line.qty) +
            "</div>" +
            '<button class="ticket-line-remove" data-action="remove" title="Quitar"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
            "</div>"
          );
        })
        .join("");

      Array.prototype.forEach.call(itemsEl.querySelectorAll(".ticket-line"), function (row) {
        var pid = row.getAttribute("data-product-id");
        row.querySelector('[data-action="inc"]').addEventListener("click", function () {
          changeTicketQty(pid, 1);
        });
        row.querySelector('[data-action="dec"]').addEventListener("click", function () {
          changeTicketQty(pid, -1);
        });
        row.querySelector('[data-action="remove"]').addEventListener("click", function () {
          removeTicketLine(pid);
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
      t.account.lines.push({
        id: "l" + Date.now() + Math.random().toString(16).slice(2, 6),
        name: p.name,
        qty: line.qty,
        unitPrice: p.price,
        mods: []
      });
    });

    state.posTicket = [];
    toast("Productos agregados a la cuenta");
    exitPosMode(true);
    renderTablesGrid();
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

    // Sidebar nav (only Salón is functional)
    Array.prototype.forEach.call(document.querySelectorAll(".sidebar .nav-item"), function (item) {
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

    renderTablesGrid();
    tickClock();
    setInterval(tickClock, 15000);
    setInterval(renderTablesGrid, 30000); // keep elapsed-time labels fresh

    applyScreenshotScene(); // dev-only helper, see below
  }

  /**
   * Screenshot/demo helper ONLY — lets evidence-capture tooling jump straight
   * to a specific screen via a URL query string, e.g.:
   *   index.html?scene=table&id=mesa-03
   *   index.html?scene=pos&table=mesa-05&demo=1
   * Not part of the product UX, not linked from anywhere in the UI itself.
   */
  function applyScreenshotScene() {
    var params = new URLSearchParams(window.location.search);
    var scene = params.get("scene");
    if (scene === "table") {
      var id = params.get("id");
      if (findTable(id)) openAccountPanel(id);
    } else if (scene === "pos") {
      var t = findTable(params.get("table")) || TABLES.find(function (x) { return x.account; });
      state.activeTableId = t.id;
      enterPosMode(t);
      if (params.get("demo") === "1") {
        addToTicket("p06"); // Taco Rib Eye
        addToTicket("p06");
        addToTicket("p18"); // Agua Mineral
        addToTicket("p24"); // Cheesecake
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
