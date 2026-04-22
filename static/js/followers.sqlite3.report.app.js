    (function () {
      const LANGUAGE_META = window.REPORT_LANGUAGE_META || {};
      const I18N = window.REPORT_I18N || {};
      let dbs = [];
      const canvas = document.getElementById("scatter");
      const ctx = canvas.getContext("2d");
      const tooltip = document.getElementById("tooltip");
      const NOW = Date.now();
      const WORD_RE = /[A-Za-z0-9_+#@']{3,}/g;
      const CJK_RE = /[\u4e00-\u9fff]{2,8}/g;
      const NUMERIC_HANDLE_RE = /\d{5,}/;
      const DEFAULT_AVATAR_MARKERS = ["default_profile", "default_profile_images"];
      const STOPWORDS = new Set([
        "the", "and", "for", "you", "your", "with", "that", "this", "from", "are",
        "but", "not", "have", "has", "was", "will", "all", "too", "out", "can",
        "its", "our", "his", "her", "him", "she", "they", "them", "their", "who",
        "what", "when", "where", "how", "why", "just", "into", "than", "then",
        "here", "there", "about", "after", "before", "more", "less", "very", "one",
        "two", "three", "www", "http", "https", "com", "co", "amp", "para", "que",
        "por", "los", "las", "der", "und", "de", "del", "con", "una", "uno"
      ]);
      const TOPIC_RULES = [
        ["Fisting/BDSM/Fetish", ["fisting", "fist", "bdsm", "fetish", "kink", "pup", "leather", "sub", "dom"]],
        ["Gay/Bear/Queer", ["gay", "bear", "queer", "lgbt", "bi", "trans", "top", "bottom", "vers"]],
        ["Commercial/Creator", ["collab", "dm", "onlyfans", "promo", "store", "shop", "service", "creator", "official"]]
      ];
      const els = {
        dbSelect: document.getElementById("db-select"),
        heroTitle: document.getElementById("hero-title"),
        heroSubtitle: document.getElementById("hero-subtitle"),
        heroNote: document.getElementById("hero-note"),
        panelTabs: document.querySelectorAll("[data-panel]"),
        panelTitle: document.getElementById("active-panel-title"),
        panelDesc: document.getElementById("active-panel-desc"),
        panelBadge: document.getElementById("active-panel-badge"),
        panelSummary: document.getElementById("panel-summary"),
        panelStructure: document.getElementById("panel-structure"),
        panelNetwork: document.getElementById("panel-network"),
        panelAccounts: document.getElementById("panel-accounts"),
        panelMap: document.getElementById("panel-map"),
        panelAi: document.getElementById("panel-ai"),
        meta: document.getElementById("meta"),
        metricGrid: document.getElementById("metric-grid"),
        distBars: document.getElementById("dist-bars"),
        keywordChips: document.getElementById("keyword-chips"),
        topicBars: document.getElementById("topic-bars"),
        locationBody: document.getElementById("location-body"),
        chartStats: document.getElementById("chart-stats"),
        low: document.getElementById("toggle-low"),
        medium: document.getElementById("toggle-medium"),
        high: document.getElementById("toggle-high"),
        top: document.getElementById("toggle-top"),
        hideHigh: document.getElementById("toggle-hide-high"),
        topTab: document.getElementById("tab-top"),
        botsTab: document.getElementById("tab-bots"),
        search: document.getElementById("search"),
        countryFilter: document.getElementById("country-filter"),
        riskFilter: document.getElementById("risk-filter"),
        sortKey: document.getElementById("sort-key"),
        sortOrder: document.getElementById("sort-order"),
        accountBody: document.getElementById("account-body"),
        selectionBody: document.getElementById("selection-body"),
        selectionSummary: document.getElementById("selection-summary"),
        selectionPrev: document.getElementById("selection-prev"),
        selectionNext: document.getElementById("selection-next"),
        selectionPageInfo: document.getElementById("selection-page-info"),
        mapCanvas: document.getElementById("map-canvas"),
        mapBody: document.getElementById("map-body"),
        mapUnmatchedBody: document.getElementById("map-unmatched-body"),
        mapMatchSummary: document.getElementById("map-match-summary"),
        mapTooltip: document.getElementById("map-tooltip"),
        aiPrompt: document.getElementById("ai-prompt"),
        copyAiPrompt: document.getElementById("copy-ai-prompt"),
        downloadTopCsv: document.getElementById("download-top-csv"),
        downloadBotCsv: document.getElementById("download-bot-csv"),
        resetView: document.getElementById("reset-view"),
        sortableHeaders: document.querySelectorAll("th[data-sort]")
      };

      const vm = {
        dbMap: new Map(),
        activeDb: null,
        allPoints: [],
        topFans: [],
        highRiskBots: [],
        sqlJsPromise: null,
        lastDrawnPoints: [],
        lastMapShapes: [],
        mapBuckets: [],
        mapUnmatched: [],
        customMapRules: [],
        isSelecting: false,
        state: {
          lang: "en",
          showLow: true,
          showMedium: true,
          showHigh: true,
          highlightTop: true,
          hideHighRisk: false,
          activePanel: "summary",
          activeList: "top",
          search: "",
          countryFilter: "all",
          riskFilter: "all",
          sortKey: "real_score",
          sortOrder: "desc",
          selection: null,
          selectionPage: 1
        },

        selectionPageSize: 25,

        t(key, vars) {
          const lang = "en";
          const dict = I18N[lang] || {};
          const fallback = I18N.en || {};
          const template = dict[key] ?? fallback[key] ?? key;
          return String(template).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ""));
        },

        detectInitialLang() {
          return "en";
        },

        setLanguage(lang) {
          this.state.lang = "en";
          const meta = LANGUAGE_META.en || { html: "en", locale: "en-US" };
          document.documentElement.lang = meta.html;
          this.render();
        },

        get currentSummary() {
          return this.activeDb.summary;
        },

        get visiblePoints() {
          return this.allPoints.filter((p) => {
            if (this.state.hideHighRisk && p.bot_bucket === "high") return false;
            if (p.bot_bucket === "low" && !this.state.showLow) return false;
            if (p.bot_bucket === "medium" && !this.state.showMedium) return false;
            if (p.bot_bucket === "high" && !this.state.showHigh) return false;
            return true;
          });
        },

        get activeList() {
          return this.state.activeList === "top" ? this.topFans : this.highRiskBots;
        },

        get filteredList() {
          const q = this.state.search.trim().toLowerCase();
          let list = this.activeList.filter((item) => {
            const mappedCountry = this.classifyLocation(item.location || "");
            if (this.state.countryFilter !== "all" && mappedCountry !== this.state.countryFilter) return false;
            if (this.state.riskFilter !== "all" && item.bot_bucket !== this.state.riskFilter) return false;
            if (!q) return true;
            return [
              item.screen_name || "",
              item.name || "",
              item.location || "",
              mappedCountry || "",
              (item.reasons || []).join(" ")
            ].join(" ").toLowerCase().includes(q);
          });
          const key = this.state.sortKey;
          const dir = this.state.sortOrder === "asc" ? 1 : -1;
          list = list.slice().sort((a, b) => {
            const av = a[key] ?? "";
            const bv = b[key] ?? "";
            if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
            if (key === "age_days") return ((Number(av) || -1) - (Number(bv) || -1)) * dir;
            return String(av).localeCompare(String(bv), (LANGUAGE_META.en || { locale: "en-US" }).locale, { numeric: true }) * dir;
          });
          return list;
        },

        get selectedPoints() {
          if (!this.state.selection) return [];
          const { x1, y1, x2, y2 } = this.state.selection;
          const minX = Math.min(x1, x2);
          const maxX = Math.max(x1, x2);
          const minY = Math.min(y1, y2);
          const maxY = Math.max(y1, y2);
          return this.lastDrawnPoints
            .filter((d) => d.x >= minX && d.x <= maxX && d.y >= minY && d.y <= maxY)
            .map((d) => d.p)
            .sort((a, b) => b.followers - a.followers || b.statuses - a.statuses)
            .slice(0, 300);
        },

        get pagedSelectedPoints() {
          const start = (this.state.selectionPage - 1) * this.selectionPageSize;
          return this.selectedPoints.slice(start, start + this.selectionPageSize);
        },

        async init() {
          this.state.lang = "en";
          this.bind();
          this.applyI18nStatic();
          await this.loadDatabaseIndex();
          this.initDbSelect();
          const defaultDb = dbs.find((db) => db.isDefault) || dbs[0];
          if (!defaultDb) {
            document.body.innerHTML = "<div style='padding:40px;font-family:Segoe UI,Microsoft YaHei,sans-serif'>没有找到可用的 SQLite 数据库。</div>";
            return;
          }
          await this.setDatabase(defaultDb.id);
        },

        async loadDatabaseIndex() {
          const response = await fetch("/static/database/index.json", { cache: "no-cache" });
          if (!response.ok) throw new Error("Failed to load database index.");
          const payload = await response.json();
          dbs = Array.isArray(payload.databases) ? payload.databases : [];
          this.dbMap = new Map(dbs.map((db) => [db.id, db]));
        },

        initDbSelect() {
          els.dbSelect.innerHTML = dbs.map((db) => `<option value="${this.escapeHtml(db.id)}">${this.escapeHtml(db.label)}</option>`).join("");
        },

        async setDatabase(id) {
          let db = this.dbMap.get(id);
          if (!db) return;
          if (!db.points) {
            els.heroNote.textContent = "Loading database...";
            db = await this.loadDatabaseFromSqlite(id);
            const index = dbs.findIndex((item) => item.id === db.id);
            if (index >= 0) dbs[index] = db;
            else dbs.push(db);
            this.dbMap.set(db.id, db);
          }
          this.activeDb = db;
          this.allPoints = db.points || [];
          this.topFans = db.topRealFans || [];
          this.highRiskBots = db.highRiskBots || [];
          const mapResult = this.computeMapBuckets(db.points || []);
          this.mapBuckets = mapResult.buckets;
          this.mapUnmatched = mapResult.unmatched;
          document.title = db.label + " - " + this.t("heroTitleSuffix");
          els.dbSelect.value = db.id;
          els.heroTitle.textContent = db.label + " " + this.t("heroTitleSuffix");
          els.heroSubtitle.textContent = this.t("heroSubtitle");
          els.heroNote.textContent = this.t("heroNote", { count: this.formatNum(dbs.length), label: db.label });
          this.state.selection = null;
          this.render();
        },

        async getSqlJs() {
          if (!this.sqlJsPromise) {
            if (typeof window.initSqlJs !== "function") {
              throw new Error("sql.js loader is not available.");
            }
            this.sqlJsPromise = window.initSqlJs({
              locateFile: () => "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/sql-wasm.wasm"
            });
          }
          return this.sqlJsPromise;
        },

        async loadDatabaseFromSqlite(id) {
          const SQL = await this.getSqlJs();
          const response = await fetch("/static/database/" + encodeURIComponent(id), { cache: "no-cache" });
          if (!response.ok) throw new Error("Failed to fetch SQLite database: " + id);
          const bytes = new Uint8Array(await response.arrayBuffer());
          const sqlite = new SQL.Database(bytes);
          try {
            const rows = this.readFollowersFromSqlite(sqlite);
            return this.buildReportFromRows(id, rows);
          } finally {
            sqlite.close();
          }
        },

        readFollowersFromSqlite(sqlite) {
          const query = `
            SELECT user_name, name, url, description, location, profile_picture,
                   followers_count, following_count, tweets_count, listed_count,
                   is_verified, is_blue_verified, created_at_text
            FROM followers
          `;
          const result = sqlite.exec(query)[0];
          if (!result) return [];
          return result.values.map((values) => {
            const row = {};
            result.columns.forEach((column, index) => {
              row[column] = values[index];
            });
            return row;
          });
        },

        buildReportFromRows(id, rows) {
          const followerBins = new Map([["0", 0], ["1-10", 0], ["11-100", 0], ["101-1k", 0], ["1k-10k", 0], ["10k+", 0]]);
          const tweetBins = new Map([["0", 0], ["1-9", 0], ["10-99", 0], ["100-999", 0], ["1000+", 0]]);
          const ageBins = new Map([["<=2017", 0], ["2018-2019", 0], ["2020-2021", 0], ["2022-2023", 0], ["2024-2026", 0], ["Unknown", 0]]);
          const riskCounts = new Map([["low", 0], ["medium", 0], ["high", 0]]);
          const locationCounts = new Map();
          const keywordCounts = new Map();
          const topicCounts = new Map();
          const points = rows.map((row) => {
            const followers = this.toInt(row.followers_count);
            const following = this.toInt(row.following_count);
            const statuses = this.toInt(row.tweets_count);
            const ageDays = this.computeAgeDays(row.created_at_text);
            const scored = this.scoreAccount(row, ageDays);
            const location = String(row.location || "").trim();
            const description = String(row.description || "").trim();

            this.bumpCounter(followerBins, this.getFollowerBin(followers));
            this.bumpCounter(tweetBins, this.getTweetBin(statuses));
            this.bumpCounter(ageBins, this.getAgeBin(row.created_at_text));
            this.bumpCounter(riskCounts, scored.bot_bucket);
            if (location) this.bumpCounter(locationCounts, location);
            this.extractKeywords(description).forEach((keyword) => this.bumpCounter(keywordCounts, keyword));
            this.detectTopics(description, location).forEach((label) => this.bumpCounter(topicCounts, label));

            return {
              screen_name: row.user_name || "",
              name: row.name || "",
              profile_url: row.url || `https://x.com/${row.user_name || ""}`,
              location,
              followers,
              following,
              statuses,
              age_days: ageDays,
              bot_bucket: scored.bot_bucket,
              bot_score: scored.bot_score,
              real_score: scored.real_score,
              reasons: scored.reasons
            };
          });

          const topRealFans = points
            .filter((item) => item.bot_bucket !== "high" && item.real_score >= 7)
            .sort((a, b) => (b.real_score - a.real_score) || (b.followers - a.followers) || (b.statuses - a.statuses))
            .slice(0, 500);
          const highRiskBots = points
            .filter((item) => item.bot_bucket === "high")
            .sort((a, b) => (b.bot_score - a.bot_score) || (a.real_score - b.real_score) || (b.following - a.following))
            .slice(0, 500);

          return {
            id,
            label: id,
            isDefault: false,
            summary: {
              total: points.length,
              bioNonempty: rows.filter((row) => String(row.description || "").trim()).length,
              locationNonempty: rows.filter((row) => String(row.location || "").trim()).length,
              riskCounts: {
                low: riskCounts.get("low") || 0,
                medium: riskCounts.get("medium") || 0,
                high: riskCounts.get("high") || 0
              },
              followersBins: this.counterEntries(followerBins),
              tweetBins: this.counterEntries(tweetBins),
              ageBins: this.counterEntries(ageBins, true),
              topLocations: this.topEntries(locationCounts, "location", 12),
              topKeywords: this.topEntries(keywordCounts, "word", 18),
              topicSlices: this.topEntries(topicCounts, "label")
            },
            points,
            topRealFans,
            highRiskBots
          };
        },

        scoreAccount(row, ageDays) {
          const followers = this.toInt(row.followers_count);
          const following = this.toInt(row.following_count);
          const statuses = this.toInt(row.tweets_count);
          const listed = this.toInt(row.listed_count);
          const description = String(row.description || "").trim();
          const location = String(row.location || "").trim();
          const handle = String(row.user_name || "").trim();
          const avatar = String(row.profile_picture || "").toLowerCase();
          const reasons = [];
          let botScore = 0;
          let realScore = 3;

          if (ageDays !== "" && ageDays < 60) {
            botScore += 3;
            reasons.push("very new account");
          } else if (ageDays !== "" && ageDays < 180) {
            botScore += 2;
            reasons.push("new account");
          } else if (ageDays !== "" && ageDays > 730) {
            realScore += 2;
          }

          if (statuses === 0) {
            botScore += 3;
            reasons.push("no posts");
          } else if (statuses < 5) {
            botScore += 2;
            reasons.push("very low activity");
          } else if (statuses < 30) {
            botScore += 1;
            reasons.push("low activity");
          } else if (statuses > 300) {
            realScore += 1;
          }

          if (followers < 10) {
            botScore += 2;
            reasons.push("very low followers");
          } else if (followers < 100) {
            botScore += 1;
            reasons.push("low followers");
          } else if (followers > 10000) {
            realScore += 2;
          } else if (followers > 1000) {
            realScore += 1;
          }

          if (following >= Math.max(followers * 8, 2000)) {
            botScore += 3;
            reasons.push("follows far more than followed");
          } else if (following >= Math.max(followers * 4, 1000)) {
            botScore += 2;
            reasons.push("high follow ratio");
          } else if (following < Math.max(followers, 1) * 2) {
            realScore += 1;
          }

          if (!description) {
            botScore += 1;
            reasons.push("no bio");
          } else {
            realScore += 1;
          }

          if (!location) {
            botScore += 1;
            reasons.push("no location");
          } else {
            realScore += 1;
          }

          if (listed > 0) realScore += 1;
          if (this.toInt(row.is_verified) || this.toInt(row.is_blue_verified)) realScore += 2;
          if (DEFAULT_AVATAR_MARKERS.some((marker) => avatar.includes(marker))) {
            botScore += 1;
            reasons.push("default avatar");
          }
          if (handle && NUMERIC_HANDLE_RE.test(handle)) {
            botScore += 1;
            reasons.push("numeric-looking handle");
          }

          const realScoreClamped = Math.max(1, Math.min(10, realScore - Math.min(Math.floor(botScore / 2), 4)));
          const botBucket = botScore >= 6 ? "high" : botScore >= 3 ? "medium" : "low";
          return {
            bot_score: botScore,
            real_score: realScoreClamped,
            bot_bucket: botBucket,
            reasons
          };
        },

        parseCreatedAt(value) {
          if (!value) return null;
          let timestamp = Date.parse(String(value));
          if (!Number.isNaN(timestamp)) return new Date(timestamp);
          const normalized = String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
          timestamp = Date.parse(normalized);
          if (!Number.isNaN(timestamp)) return new Date(timestamp);
          return null;
        },

        computeAgeDays(value) {
          const date = this.parseCreatedAt(value);
          if (!date) return "";
          return Math.max(Math.floor((NOW - date.getTime()) / 86400000), 0);
        },

        getAgeBin(value) {
          const date = this.parseCreatedAt(value);
          if (!date) return "Unknown";
          const year = date.getUTCFullYear();
          if (year <= 2017) return "<=2017";
          if (year <= 2019) return "2018-2019";
          if (year <= 2021) return "2020-2021";
          if (year <= 2023) return "2022-2023";
          return "2024-2026";
        },

        getFollowerBin(value) {
          if (value === 0) return "0";
          if (value <= 10) return "1-10";
          if (value <= 100) return "11-100";
          if (value <= 1000) return "101-1k";
          if (value <= 10000) return "1k-10k";
          return "10k+";
        },

        getTweetBin(value) {
          if (value === 0) return "0";
          if (value <= 9) return "1-9";
          if (value <= 99) return "10-99";
          if (value <= 999) return "100-999";
          return "1000+";
        },

        extractKeywords(text) {
          const normalized = String(text || "");
          const latinWords = (normalized.toLowerCase().match(WORD_RE) || [])
            .map((word) => word.replace(/^[_#@'+]+|[_#@'+]+$/g, ""))
            .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
          return latinWords.concat(normalized.match(CJK_RE) || []);
        },

        detectTopics(description, location) {
          const text = `${String(description || "").toLowerCase()} ${String(location || "").toLowerCase()}`;
          return TOPIC_RULES
            .filter(([, keys]) => keys.some((key) => text.includes(key)))
            .map(([label]) => label);
        },

        bumpCounter(counter, key) {
          counter.set(key, (counter.get(key) || 0) + 1);
        },

        counterEntries(counter, hideZero) {
          return Array.from(counter.entries())
            .filter(([, count]) => !hideZero || count)
            .map(([label, count]) => ({ label, count }));
        },

        topEntries(counter, keyName, limit) {
          return Array.from(counter.entries())
            .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "en-US", { numeric: true }))
            .slice(0, limit || counter.size)
            .map(([key, count]) => ({ [keyName]: key, count }));
        },

        toInt(value) {
          const num = Number(value || 0);
          return Number.isFinite(num) ? Math.trunc(num) : 0;
        },

        bind() {
          els.dbSelect.addEventListener("change", async () => this.setDatabase(els.dbSelect.value));
          els.panelTabs.forEach((btn) => {
            btn.addEventListener("click", () => {
              this.state.activePanel = btn.dataset.panel;
              this.syncControls();
              this.renderActivePanel();
            });
          });
          els.low.addEventListener("change", () => { this.state.showLow = els.low.checked; this.renderChartArea(); });
          els.medium.addEventListener("change", () => { this.state.showMedium = els.medium.checked; this.renderChartArea(); });
          els.high.addEventListener("change", () => { this.state.showHigh = els.high.checked; this.renderChartArea(); });
          els.top.addEventListener("change", () => { this.state.highlightTop = els.top.checked; this.renderChart(); });
          els.hideHigh.addEventListener("change", () => { this.state.hideHighRisk = els.hideHigh.checked; this.renderChartArea(); });
          els.topTab.addEventListener("click", () => {
            this.state.activeList = "top";
            this.state.sortKey = "real_score";
            this.state.sortOrder = "desc";
            this.renderTable();
            this.syncControls();
          });
          els.botsTab.addEventListener("click", () => {
            this.state.activeList = "bots";
            this.state.sortKey = "bot_score";
            this.state.sortOrder = "desc";
            this.renderTable();
            this.syncControls();
          });
          els.search.addEventListener("input", () => { this.state.search = els.search.value; this.renderTable(); });
          els.countryFilter.addEventListener("change", () => { this.state.countryFilter = els.countryFilter.value; this.renderTable(); });
          els.riskFilter.addEventListener("change", () => { this.state.riskFilter = els.riskFilter.value; this.renderTable(); });
          els.sortKey.addEventListener("change", () => { this.state.sortKey = els.sortKey.value; this.renderTable(); });
          els.sortOrder.addEventListener("change", () => { this.state.sortOrder = els.sortOrder.value; this.renderTable(); });
          els.selectionPrev.addEventListener("click", () => {
            if (this.state.selectionPage > 1) {
              this.state.selectionPage -= 1;
              this.renderSelectionTable();
            }
          });
          els.selectionNext.addEventListener("click", () => {
            const totalPages = Math.max(1, Math.ceil(this.selectedPoints.length / this.selectionPageSize));
            if (this.state.selectionPage < totalPages) {
              this.state.selectionPage += 1;
              this.renderSelectionTable();
            }
          });
          els.mapCanvas.addEventListener("mousemove", (event) => this.onMapHover(event));
          els.mapCanvas.addEventListener("mouseleave", () => this.clearMapHover());
          els.mapCanvas.addEventListener("click", (event) => this.onMapClick(event));
          els.mapUnmatchedBody.addEventListener("click", (event) => this.onMapSuggestionClick(event));
          if (els.copyAiPrompt) {
            els.copyAiPrompt.addEventListener("click", async () => {
              const text = els.aiPrompt ? els.aiPrompt.value : "";
              if (!text) return;
              try {
                await navigator.clipboard.writeText(text);
                els.copyAiPrompt.textContent = this.t("copied");
                setTimeout(() => {
                  if (els.copyAiPrompt) els.copyAiPrompt.textContent = this.t("copyPrompt");
                }, 1600);
              } catch (_) {
                if (els.aiPrompt) {
                  els.aiPrompt.focus();
                  els.aiPrompt.select();
                }
              }
            });
          }
          els.sortableHeaders.forEach((th) => {
            th.addEventListener("click", () => {
              const key = th.dataset.sort;
              if (this.state.sortKey === key) this.state.sortOrder = this.state.sortOrder === "desc" ? "asc" : "desc";
              else {
                this.state.sortKey = key;
                this.state.sortOrder = key === "screen_name" ? "asc" : "desc";
              }
              this.syncControls();
              this.renderTable();
            });
          });
          els.resetView.addEventListener("click", () => {
            this.state = {
              showLow: true,
              showMedium: true,
              showHigh: true,
              highlightTop: true,
              hideHighRisk: false,
              activePanel: "summary",
              activeList: "top",
              lang: this.state.lang,
              search: "",
              countryFilter: "all",
              riskFilter: "all",
              sortKey: "real_score",
              sortOrder: "desc",
              selection: null,
              selectionPage: 1
            };
            this.syncControls();
            this.render();
          });
          els.downloadTopCsv.addEventListener("click", () => this.downloadCsv(this.topFans, this.activeDb.label + ".top-fans.csv"));
          els.downloadBotCsv.addEventListener("click", () => this.downloadCsv(this.highRiskBots, this.activeDb.label + ".high-risk.csv"));
          canvas.addEventListener("mousemove", (event) => this.onHover(event));
          canvas.addEventListener("mouseleave", () => this.clearHover());
          canvas.addEventListener("mousedown", (event) => this.startSelection(event));
          window.addEventListener("mousemove", (event) => this.moveSelection(event));
          window.addEventListener("mouseup", () => this.endSelection());
        },

        syncControls() {
          els.low.checked = this.state.showLow;
          els.medium.checked = this.state.showMedium;
          els.high.checked = this.state.showHigh;
          els.top.checked = this.state.highlightTop;
          els.hideHigh.checked = this.state.hideHighRisk;
          els.search.value = this.state.search;
          if (els.countryFilter) els.countryFilter.value = this.state.countryFilter;
          els.riskFilter.value = this.state.riskFilter;
          els.sortKey.value = this.state.sortKey;
          els.sortOrder.value = this.state.sortOrder;
          els.topTab.classList.toggle("active", this.state.activeList === "top");
          els.botsTab.classList.toggle("active", this.state.activeList === "bots");
          els.panelTabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.panel === this.state.activePanel));
          els.panelSummary.hidden = this.state.activePanel !== "summary";
          els.panelStructure.hidden = this.state.activePanel !== "structure";
          els.panelNetwork.hidden = this.state.activePanel !== "network";
          els.panelAccounts.hidden = this.state.activePanel !== "accounts";
          els.panelMap.hidden = this.state.activePanel !== "map";
          if (els.panelAi) els.panelAi.hidden = this.state.activePanel !== "ai";
        },

        render() {
          this.applyI18nStatic();
          this.syncControls();
          this.renderActivePanel();
          this.renderMeta();
          this.renderSummary();
          this.renderStructure();
          this.renderChartArea();
          this.renderTable();
          this.renderMapArea();
          this.renderAiAnalysis();
          this.renderSelectionTable();
        },

        applyI18nStatic() {
          const root = document.documentElement;
          const meta = LANGUAGE_META.en || { html: "en", locale: "en-US" };
          root.lang = meta.html;
          const setText = (selector, text) => {
            const node = document.querySelector(selector);
            if (node) node.textContent = text;
          };
          const setHtml = (selector, html) => {
            const node = document.querySelector(selector);
            if (node) node.innerHTML = html;
          };
          if (this.activeDb) {
            document.title = this.activeDb.label + " - " + this.t("heroTitleSuffix");
            els.heroTitle.textContent = this.activeDb.label + " " + this.t("heroTitleSuffix");
            els.heroSubtitle.textContent = this.t("heroSubtitle");
            els.heroNote.textContent = this.t("heroNote", { count: this.formatNum(dbs.length), label: this.activeDb.label });
          }
          setText('label[for="db-select"]', this.t("databaseLabel"));
          const tabs = {
            summary: ["tabSummaryTitle", "tabSummaryDesc"],
            structure: ["tabStructureTitle", "tabStructureDesc"],
            network: ["tabNetworkTitle", "tabNetworkDesc"],
            accounts: ["tabAccountsTitle", "tabAccountsDesc"],
            map: ["tabMapTitle", "tabMapDesc"],
            ai: ["tabAiTitle", "tabAiDesc"]
          };
          Object.entries(tabs).forEach(([panel, [titleKey, descKey]]) => {
            const btn = document.querySelector(`.view-btn[data-panel="${panel}"]`);
            if (!btn) return;
            btn.innerHTML = `<strong>${this.t(titleKey)}</strong><span>${this.t(descKey)}</span>`;
          });
          setText("#panel-summary .section-head .eyebrow", this.t("sectionSummaryEyebrow"));
          setText("#panel-summary .section-head h2", this.t("sectionSummaryTitle"));
          setText("#panel-summary .section-note", this.t("sectionSummaryNote"));
          setText("#panel-structure .section-head .eyebrow", this.t("sectionStructureEyebrow"));
          setText("#panel-structure .section-head h2", this.t("sectionStructureTitle"));
          setText("#panel-structure .section-note", this.t("sectionStructureNote"));
          setText("#panel-structure .grid.two .panel:nth-of-type(1) h3", this.t("structureDistTitle"));
          setText("#panel-structure .grid.two .panel:nth-of-type(2) h3", this.t("structureTopicTitle"));
          setText("#panel-structure thead th:nth-child(1)", this.t("locationHeader"));
          setText("#panel-structure thead th:nth-child(2)", this.t("countHeader"));
          setText("#panel-network .section-head .eyebrow", this.t("sectionNetworkEyebrow"));
          setText("#panel-network .section-head h2", this.t("sectionNetworkTitle"));
          setText("#panel-network .section-note", this.t("sectionNetworkNote"));
          const networkLabels = [
            [els.low?.parentElement, this.t("toggleLow")],
            [els.medium?.parentElement, this.t("toggleMedium")],
            [els.high?.parentElement, this.t("toggleHigh")],
            [els.top?.parentElement, this.t("toggleTop")],
            [els.hideHigh?.parentElement, this.t("toggleHideHigh")]
          ];
          networkLabels.forEach(([labelNode, text]) => {
            if (!labelNode) return;
            const input = labelNode.querySelector("input");
            if (!input) return;
            labelNode.innerHTML = "";
            labelNode.appendChild(input);
            labelNode.appendChild(document.createTextNode(" " + text));
          });
          setText("#panel-network .grid.two .panel:nth-of-type(2) h3", this.t("actionHelpTitle"));
          if (els.downloadTopCsv) els.downloadTopCsv.textContent = this.t("downloadTopCsv");
          if (els.downloadBotCsv) els.downloadBotCsv.textContent = this.t("downloadBotCsv");
          if (els.resetView) els.resetView.textContent = this.t("resetView");
          setText("#panel-network .grid.two .panel:nth-of-type(2) .note-box", this.t("networkHelp"));
          setText("#panel-network .panel[style*='margin-top:18px'] .section-head .eyebrow", this.t("brushEyebrow"));
          setText("#panel-network .panel[style*='margin-top:18px'] .section-head h3", this.t("brushTitle"));
          setText("#panel-network .panel[style*='margin-top:18px'] .section-note", this.t("brushNote"));
          if (els.selectionPrev) els.selectionPrev.textContent = this.t("prevPage");
          if (els.selectionNext) els.selectionNext.textContent = this.t("nextPage");
          setText("#panel-network details summary", this.t("selectionTableTitle"));
          setText("#panel-network thead th:nth-child(1)", this.t("nameHeader"));
          setText("#panel-network thead th:nth-child(2)", this.t("accountHeader"));
          setText("#panel-network thead th:nth-child(3)", this.t("ageDaysHeader"));
          setText("#panel-network thead th:nth-child(4)", this.t("followersHeader"));
          setText("#panel-network thead th:nth-child(5)", this.t("followingHeader"));
          setText("#panel-network thead th:nth-child(6)", this.t("statusesHeader"));
          setText("#panel-accounts .section-head .eyebrow", this.t("sectionAccountsEyebrow"));
          setText("#panel-accounts .section-head h2", this.t("sectionAccountsTitle"));
          setText("#panel-accounts .section-note", this.t("sectionAccountsNote"));
          if (els.topTab) els.topTab.textContent = this.t("topTab");
          if (els.botsTab) els.botsTab.textContent = this.t("botsTab");
          setText('label[for="search"]', this.t("searchLabel"));
          if (els.search) els.search.placeholder = this.t("searchPlaceholder");
          setText('label[for="country-filter"]', this.t("countryFilterLabel"));
          setText('label[for="risk-filter"]', this.t("riskFilterLabel"));
          setText('label[for="sort-key"]', this.t("sortKeyLabel"));
          setText('label[for="sort-order"]', this.t("sortOrderLabel"));
          setText("#panel-accounts details summary", this.t("accountListTitle"));
          const accountHeaders = document.querySelectorAll("#panel-accounts thead th");
          [
            this.t("accountHeader"),
            this.t("ageDaysHeader"),
            this.t("followersHeader"),
            this.t("followingHeader"),
            this.t("statusesHeader"),
            this.t("riskHeader"),
            this.t("botScoreHeader"),
            this.t("realScoreHeader"),
            this.t("locationReasonHeader"),
            this.t("openHeader")
          ].forEach((text, index) => {
            if (accountHeaders[index]) accountHeaders[index].textContent = text;
          });
          setText("#panel-map .section-head .eyebrow", this.t("sectionMapEyebrow"));
          setText("#panel-map .section-head h2", this.t("sectionMapTitle"));
          setText("#panel-map .section-note", this.t("sectionMapNote"));
          const legendSpans = document.querySelectorAll("#panel-map .legend-row span");
          if (legendSpans[0]) legendSpans[0].textContent = this.t("mapLowDensity");
          if (legendSpans[1] && !legendSpans[1].id) legendSpans[1].textContent = this.t("mapHighDensity");
          setText("#panel-map .panel:nth-of-type(2) h3", this.t("mapTopLocations"));
          setText("#panel-map .panel:nth-of-type(2) .note-box", this.t("mapCoarseNote"));
          const mapHeaders = document.querySelectorAll("#panel-map .panel:nth-of-type(2) table thead th");
          if (mapHeaders[0]) mapHeaders[0].textContent = this.t("locationHeader");
          if (mapHeaders[1]) mapHeaders[1].textContent = this.t("countHeader");
          if (mapHeaders[2]) mapHeaders[2].textContent = this.t("matchedShareHeader");
          const mapSecondTitle = document.querySelector("#panel-map .panel:nth-of-type(2) h3[style*='margin-top:18px;']");
          if (mapSecondTitle) mapSecondTitle.textContent = this.t("mapUnmatchedTitle");
          const mapNoteBoxes = document.querySelectorAll("#panel-map .panel:nth-of-type(2) .note-box");
          if (mapNoteBoxes[1]) mapNoteBoxes[1].textContent = this.t("mapUnmatchedNote");
          const unmatchedHeaders = document.querySelectorAll("#panel-map .panel:nth-of-type(2) .table-wrap:last-of-type thead th");
          if (unmatchedHeaders[0]) unmatchedHeaders[0].textContent = this.t("rawLocationHeader");
          if (unmatchedHeaders[1]) unmatchedHeaders[1].textContent = this.t("countHeader");
          if (unmatchedHeaders[2]) unmatchedHeaders[2].textContent = this.t("actionHeader");
          setText("#panel-ai .section-head .eyebrow", this.t("sectionAiEyebrow"));
          setText("#panel-ai .section-head h2", this.t("sectionAiTitle"));
          setText("#panel-ai .section-note", this.t("sectionAiNote"));
          if (els.copyAiPrompt) els.copyAiPrompt.textContent = this.t("copyPrompt");
          if (els.sortKey) {
            els.sortKey.innerHTML = [
              ["real_score", this.t("sortRealScore")],
              ["bot_score", this.t("sortBotScore")],
              ["followers", this.t("sortFollowers")],
              ["following", this.t("sortFollowing")],
              ["statuses", this.t("sortStatuses")],
              ["age_days", this.t("sortAgeDays")],
              ["screen_name", this.t("sortScreenName")]
            ].map(([value, text]) => `<option value="${value}">${text}</option>`).join("");
            els.sortKey.value = this.state.sortKey;
          }
          if (els.sortOrder) {
            els.sortOrder.innerHTML = [
              ["desc", this.t("sortDesc")],
              ["asc", this.t("sortAsc")]
            ].map(([value, text]) => `<option value="${value}">${text}</option>`).join("");
            els.sortOrder.value = this.state.sortOrder;
          }
          if (els.riskFilter) {
            els.riskFilter.innerHTML = [
              ["all", this.t("riskAll")],
              ["low", this.t("riskLowOnly")],
              ["medium", this.t("riskMediumOnly")],
              ["high", this.t("riskHighOnly")]
            ].map(([value, text]) => `<option value="${value}">${text}</option>`).join("");
            els.riskFilter.value = this.state.riskFilter;
          }
        },

        renderActivePanel() {
          const panels = {
            summary: {
              title: this.t("tabSummaryTitle"),
              desc: this.t("panelSummaryDesc"),
              badge: this.t("panelSummaryBadge")
            },
            structure: {
              title: this.t("tabStructureTitle"),
              desc: this.t("panelStructureDesc"),
              badge: this.t("panelStructureBadge")
            },
            network: {
              title: this.t("tabNetworkTitle"),
              desc: this.t("panelNetworkDesc"),
              badge: this.t("panelNetworkBadge")
            },
            accounts: {
              title: this.t("tabAccountsTitle"),
              desc: this.t("panelAccountsDesc"),
              badge: this.t("panelAccountsBadge")
            },
            map: {
              title: this.t("tabMapTitle"),
              desc: this.t("panelMapDesc"),
              badge: this.t("panelMapBadge")
            },
            ai: {
              title: this.t("tabAiTitle"),
              desc: this.t("panelAiDesc"),
              badge: this.t("panelAiBadge")
            }
          };
          const meta = panels[this.state.activePanel] || panels.summary;
          els.panelTitle.textContent = meta.title;
          els.panelDesc.textContent = meta.desc;
          els.panelBadge.textContent = meta.badge;
        },

        renderMeta() {
          const s = this.currentSummary;
          const risk = s.riskCounts || {};
          const total = Math.max(s.total || 1, 1);
          const cards = [
            {
              label: this.t("metaTotal"),
              value: this.formatNum(s.total),
              note: this.t("metaTotalNote")
            },
            {
              label: this.t("metaBio"),
              value: this.formatPct((s.bioNonempty || 0) / total),
              note: this.t("metaBioNote", { count: this.formatNum(s.bioNonempty || 0) })
            },
            {
              label: this.t("metaLocation"),
              value: this.formatPct((s.locationNonempty || 0) / total),
              note: this.t("metaLocationNote", { count: this.formatNum(s.locationNonempty || 0) })
            },
            {
              label: this.t("metaHighRisk"),
              value: this.formatPct((risk.high || 0) / total),
              note: this.t("metaHighRiskNote")
            }
          ];
          els.meta.innerHTML = cards.map((item) => `
            <div class="meta-card">
              <div class="meta-label">${item.label}</div>
              <div class="meta-value">${item.value}</div>
              <div class="meta-note">${item.note}</div>
            </div>
          `).join("");
        },

        renderSummary() {
          const s = this.currentSummary;
          const risk = s.riskCounts || {};
          const metrics = [
            { label: this.t("metaTotal"), value: this.formatNum(s.total), desc: "" },
            { label: this.t("metaBio"), value: this.formatPct((s.bioNonempty || 0) / Math.max(s.total || 1, 1)), desc: this.formatNum(s.bioNonempty || 0) },
            { label: this.t("metaLocation"), value: this.formatPct((s.locationNonempty || 0) / Math.max(s.total || 1, 1)), desc: this.formatNum(s.locationNonempty || 0) },
            { label: this.t("metricLow"), value: this.formatNum(risk.low || 0), desc: "" },
            { label: this.t("metricMedium"), value: this.formatNum(risk.medium || 0), desc: "" },
            { label: this.t("metricHigh"), value: this.formatNum(risk.high || 0), desc: "" },
            { label: this.t("metricTop"), value: this.formatNum(this.topFans.length), desc: "" }
          ];
          els.metricGrid.innerHTML = metrics.map((item) => `
            <div class="metric">
              <div class="label">${item.label}</div>
              <div class="value">${item.value}</div>
              <div class="desc">${item.desc || "&nbsp;"}</div>
            </div>
          `).join("");
        },

        renderStructure() {
          const s = this.currentSummary;
          const blocks = [
            { title: this.t("blockFollowers"), rows: s.followersBins || [] },
            { title: this.t("blockStatuses"), rows: s.tweetBins || [] },
            { title: this.t("blockAge"), rows: s.ageBins || [] }
          ];
          els.distBars.innerHTML = blocks.map((block, index) => `
            <div class="donut-card">
              <div class="donut-title">${block.title}</div>
              <div class="donut-wrap">
                <canvas class="donut-canvas" data-donut-index="${index}" width="160" height="160" aria-label="${this.escapeHtml(block.title)} donut chart"></canvas>
                <div class="donut-center">
                  <div class="donut-total">${this.formatNum(block.rows.reduce((sum, row) => sum + (row.count || 0), 0))}</div>
                  <div class="donut-total-label">Total</div>
                </div>
              </div>
              <div class="donut-legend">
                ${block.rows.map((row, rowIndex) => `
                  <div class="donut-legend-row">
                    <span class="donut-dot" style="background:${this.getDonutColor(rowIndex)}"></span>
                    <span>${this.escapeHtml(row.label)}</span>
                    <span class="donut-legend-value">${this.formatNum(row.count || 0)}</span>
                  </div>
                `).join("")}
              </div>
            </div>
          `).join("");
          els.distBars.querySelectorAll(".donut-canvas").forEach((canvasNode, index) => {
            this.drawDonutChart(canvasNode, blocks[index]?.rows || []);
          });
          els.keywordChips.innerHTML = (s.topKeywords || []).slice(0, 16).map((item) => `
            <span class="chip"><code>${this.escapeHtml(item.word)}</code><b>${this.formatNum(item.count)}</b></span>
          `).join("");
          els.topicBars.innerHTML = this.renderBars(s.topicSlices || []);
          els.locationBody.innerHTML = (s.topLocations || []).map((row) => `
            <tr><td>${this.escapeHtml(row.location || "—")}</td><td>${this.formatNum(row.count)}</td></tr>
          `).join("");
        },

        renderChartArea() {
          this.renderChartStats();
          this.renderChart();
          this.renderSelectionTable();
        },

        renderChartStats() {
          const visible = this.visiblePoints;
          const total = Math.max(visible.length, 1);
          const risk = {
            high: visible.filter((p) => p.bot_bucket === "high").length,
            medium: visible.filter((p) => p.bot_bucket === "medium").length,
            low: visible.filter((p) => p.bot_bucket === "low").length
          };
          const stats = [
            { label: this.t("statsVisible"), value: this.formatNum(visible.length), desc: this.t("statsVisibleDesc") },
            { label: this.t("statsLow"), value: this.formatPct(risk.low / total), desc: this.t("countUnit", { count: this.formatNum(risk.low) }) },
            { label: this.t("statsMedium"), value: this.formatPct(risk.medium / total), desc: this.t("countUnit", { count: this.formatNum(risk.medium) }) },
            { label: this.t("statsHigh"), value: this.formatPct(risk.high / total), desc: this.t("countUnit", { count: this.formatNum(risk.high) }) }
          ];
          els.chartStats.innerHTML = stats.map((item) => `
            <div class="stat">
              <div class="label">${item.label}</div>
              <div class="value">${item.value}</div>
              <div class="desc">${item.desc}</div>
            </div>
          `).join("");
        },

        renderTable() {
          els.accountBody.innerHTML = this.filteredList.map((item) => {
            const reasons = (item.reasons || []).join(" / ");
            return `
              <tr>
                <td><a href="${item.profile_url}" target="_blank" rel="noreferrer noopener">@${this.escapeHtml(item.screen_name)}</a><br>${this.escapeHtml(item.name || "")}</td>
                <td>${item.age_days === "" ? "-" : this.formatNum(item.age_days)}</td>
                <td>${this.formatNum(item.followers)}</td>
                <td>${this.formatNum(item.following)}</td>
                <td>${this.formatNum(item.statuses)}</td>
                <td><span class="pill ${item.bot_bucket}">${this.riskBucketLabel(item.bot_bucket)}</span></td>
                <td>${item.bot_score}</td>
                <td>${item.real_score}</td>
                <td>${this.escapeHtml(item.location || reasons || "-")}</td>
                <td><a href="${item.profile_url}" target="_blank" rel="noreferrer noopener">${this.t("open")}</a></td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="10">${this.t("noResults")}</td></tr>`;
        },

        renderSelectionTable() {
          const rows = this.selectedPoints;
          const totalPages = Math.max(1, Math.ceil(rows.length / this.selectionPageSize));
          if (this.state.selectionPage > totalPages) this.state.selectionPage = totalPages;
          if (!rows.length) {
            els.selectionBody.innerHTML = `<tr><td colspan="6">${this.t("selectionEmpty")}</td></tr>`;
            els.selectionSummary.textContent = this.t("selectionHint");
            els.selectionPageInfo.textContent = this.t("pageInfo", { page: this.formatNum(1), total: this.formatNum(1) });
            els.selectionPrev.disabled = true;
            els.selectionNext.disabled = true;
            return;
          }
          els.selectionSummary.textContent = this.t("selectionTableSummary", { count: this.formatNum(rows.length) });
          els.selectionPageInfo.textContent = this.t("pageInfo", { page: this.formatNum(this.state.selectionPage), total: this.formatNum(totalPages) });
          els.selectionPrev.disabled = this.state.selectionPage <= 1;
          els.selectionNext.disabled = this.state.selectionPage >= totalPages;
          els.selectionBody.innerHTML = this.pagedSelectedPoints.map((item) => `
            <tr>
              <td>${this.escapeHtml(item.name || item.screen_name)}</td>
              <td><a href="${item.profile_url}" target="_blank" rel="noreferrer noopener">@${this.escapeHtml(item.screen_name)}</a></td>
              <td>${item.age_days === "" ? "-" : this.formatNum(item.age_days)}</td>
              <td>${this.formatNum(item.followers)}</td>
              <td>${this.formatNum(item.following)}</td>
              <td>${this.formatNum(item.statuses)}</td>
            </tr>
          `).join("");
        },

        renderMapArea() {
          this.renderCountryFilterOptions();
          this.renderMapCanvas();
          this.renderMapTable();
        },

        renderAiAnalysis() {
          if (!els.aiPrompt || !this.activeDb) return;
          const s = this.currentSummary;
          const risk = s.riskCounts || {};
          const topKeywords = (s.topKeywords || []).slice(0, 20).map((item) => `${item.word} (${item.count})`).join(", ");
          const topLocations = (s.topLocations || []).slice(0, 15).map((item) => `${item.location || "-"} (${item.count})`).join(", ");
          const followerBins = (s.followersBins || []).map((item) => `${item.label}: ${item.count}`).join(", ");
          const tweetBins = (s.tweetBins || []).map((item) => `${item.label}: ${item.count}`).join(", ");
          const ageBins = (s.ageBins || []).map((item) => `${item.label}: ${item.count}`).join(", ");
          const topicSlices = (s.topicSlices || []).map((item) => `${item.label}: ${item.count}`).join(", ");
          const mapTop = (this.mapBuckets || []).slice(0, 15).map((item) => `${item.label} (${item.count})`).join(", ");
          const unmatchedTop = (this.mapUnmatched || []).slice(0, 12).map((item) => `${item.location} (${item.count})`).join(", ");
          els.aiPrompt.value = [
            `You are analyzing a follower database called "${this.activeDb.label}".`,
            `Use only the data provided below. Do not assume unsupported facts. Separate direct facts, plausible interpretations, uncertainty, and data limitations.`,
            ``,
            `Output requirements:`,
            `1. Write the answer in English.`,
            `2. Split the answer into four sections: Direct Facts, Plausible Interpretations, Risks and Limitations, Recommended Next Analyses.`,
            `3. Do not use moral judgment or sensational language.`,
            `4. If a conclusion depends on heuristic scoring, explicitly say it is heuristic.`,
            `5. If location data is rule-matched or incomplete, explicitly mention that limitation.`,
            ``,
            `Database summary:`,
            `- Total follower accounts: ${s.total || 0}`,
            `- Accounts with bio: ${s.bioNonempty || 0}`,
            `- Accounts with location: ${s.locationNonempty || 0}`,
            `- Heuristic risk counts: low=${risk.low || 0}, medium=${risk.medium || 0}, high=${risk.high || 0}`,
            `- High-value candidate count: ${this.topFans.length}`,
            `- High-risk account count: ${this.highRiskBots.length}`,
            ``,
            `Distributions:`,
            `- Followers bins: ${followerBins || "n/a"}`,
            `- Post count bins: ${tweetBins || "n/a"}`,
            `- Signup era bins: ${ageBins || "n/a"}`,
            `- Topic slices: ${topicSlices || "n/a"}`,
            ``,
            `Top keywords:`,
            `${topKeywords || "n/a"}`,
            ``,
            `Top raw locations:`,
            `${topLocations || "n/a"}`,
            ``,
            `Matched countries/regions on map:`,
            `${mapTop || "n/a"}`,
            ``,
            `High-frequency unmatched locations:`,
            `${unmatchedTop || "n/a"}`,
            ``,
            `Interpretation constraints:`,
            `- Treat bot/risk fields as heuristic only.`,
            `- Treat map output as keyword/rule-based matching, not precise geocoding.`,
            `- Do not infer the account owner's personal intent or preferences from follower data alone unless the evidence is strong, and clearly mark it as inference.`,
            `- Prioritize what the current data directly supports.`
          ].join("\n");
        },

        renderCountryFilterOptions() {
          const current = this.state.countryFilter;
          const options = [`<option value="all">${this.t("countryFilterAll")}</option>`].concat(
            this.mapBuckets.map((bucket) => `<option value="${this.escapeHtml(bucket.label)}">${this.escapeHtml(bucket.label)} (${this.formatNum(bucket.count)})</option>`)
          );
          els.countryFilter.innerHTML = options.join("");
          els.countryFilter.value = current && options.join("").includes(`value="${this.escapeHtml(current)}"`) ? current : "all";
          if (els.countryFilter.value !== current) this.state.countryFilter = els.countryFilter.value;
        },

        renderMapCanvas() {
          const canvas2 = els.mapCanvas;
          const ctx2 = canvas2.getContext("2d");
          const width = 960;
          const height = 480;
          const buckets = this.mapBuckets || [];
          const world = window.WORLD_COUNTRIES_GEOJSON;
          ctx2.clearRect(0, 0, width, height);
          ctx2.fillStyle = "#eef6f3";
          ctx2.fillRect(0, 0, width, height);
          if (!world || !Array.isArray(world.features)) {
            ctx2.fillStyle = "#61706b";
            ctx2.font = "16px Segoe UI";
            ctx2.fillText(this.t("missingWorldMap"), 32, 48);
            els.mapMatchSummary.textContent = this.t("missingWorldMap");
            return;
          }
          const counts = new Map(buckets.map((b) => [b.label, b.count]));
          const max = Math.max(...buckets.map((b) => b.count), 1);
          this.lastMapShapes = [];
          world.features.forEach((feature) => {
            const name = feature?.properties?.name || "";
            const count = counts.get(name) || 0;
            const intensity = count ? (count / max) : 0;
            const path = this.buildGeometryPath(feature.geometry, width, height);
            if (!path) return;
            ctx2.fillStyle = count
              ? `rgba(13,124,102,${0.18 + intensity * 0.72})`
              : "#d7e7e1";
            ctx2.fill(path);
            ctx2.strokeStyle = count ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.65)";
            ctx2.lineWidth = count ? 0.9 : 0.6;
            ctx2.stroke(path);
            if (count) {
              this.lastMapShapes.push({ path, name, count });
            }
          });
          const matched = buckets.reduce((sum, b) => sum + b.count, 0);
          els.mapMatchSummary.textContent = this.t("mapMatched", { count: this.formatNum(matched) });
        },

        renderMapTable() {
          const total = Math.max(this.mapBuckets.reduce((sum, b) => sum + b.count, 0), 1);
          els.mapBody.innerHTML = this.mapBuckets.slice(0, 18).map((bucket) => `
            <tr>
              <td>${this.escapeHtml(bucket.label)}</td>
              <td>${this.formatNum(bucket.count)}</td>
              <td>${this.formatPct(bucket.count / total)}</td>
            </tr>
          `).join("") || `<tr><td colspan="3">${this.t("noMapSamples")}</td></tr>`;
          els.mapUnmatchedBody.innerHTML = this.mapUnmatched.slice(0, 18).map((item) => `
            <tr>
              <td>${this.escapeHtml(item.location)}</td>
              <td>${this.formatNum(item.count)}</td>
              <td>${item.suggested ? `<button class="btn" type="button" data-location="${this.escapeHtml(item.location)}" data-country="${this.escapeHtml(item.suggested)}">${this.t("assignTo", { country: this.escapeHtml(item.suggested) })}</button>` : this.t("noSuggestion")}</td>
            </tr>
          `).join("") || `<tr><td colspan="3">${this.t("noUnmatched")}</td></tr>`;
        },

        normalizeLocation(value) {
          return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[，、／/\\|·•;；:：()\[\]{}<>]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        },

        getLocationRules() {
          const rules = [
            { label: "China", keys: ["beijing","北京","shanghai","上海","guangzhou","广州","shenzhen","深圳","chengdu","成都","hangzhou","杭州","wuhan","武汉","nanjing","南京","chongqing","重庆","china","中国","中华人民共和国","people s republic of china","guangdong","zhejiang","suzhou","青岛","xian","西安","shenyang","沈阳","tianjin","天津","zhengzhou","郑州","jiangsu","江苏","liaoning","辽宁","fujian","福建","sichuan","四川","guangxi","广西","shandong","山东","anhui","安徽","hunan","湖南","hebei","河北","yunnan","云南","hubei","湖北","guizhou","贵州","jiangxi","江西","shanxi","山西","inner mongolia","内蒙古","bj"] },
            { label: "Hong Kong S.A.R.", keys: ["hong kong","香港","tsuen wan","wan chai","灣仔","九龙城","kowloon city","hongkong"] },
            { label: "Taiwan", keys: ["taiwan","台灣","台湾","taipei","台北","台北市","taichung","台中","台中市","桃園","taoyuan","new taipei","新北市","tainan","高雄","kaohsiung","桃園縣"] },
            { label: "Japan", keys: ["japan","日本","tokyo","東京","osaka","大阪","yamaguchi","関東","iwakuni","tokyo to","chiyoda","shinjuku","shibuya","taito","kunitachi","hino","kumamoto","kanagawa"] },
            { label: "United States of America", keys: ["united states","usa","america","美国","new york","los angeles","california","seattle","chicago","san francisco","new york ny","georgia usa","florida usa","washington dc","san jose ca","houston tx","north carolina usa","los angeles ca","california usa","japantown san francisco"] },
            { label: "Canada", keys: ["canada","toronto","ontario","quebec"] },
            { label: "Mexico", keys: ["mexico","mexico city","cdmx","distrito federal","guadalajara","jalisco","cuauhtemoc"] },
            { label: "Brazil", keys: ["brasil","brazil","sao paulo","americana brasil"] },
            { label: "United Kingdom", keys: ["uk","united kingdom","england","essex","london","city of london"] },
            { label: "France", keys: ["france","paris"] },
            { label: "Germany", keys: ["germany","berlin","frankfurt","hessen","hesse"] },
            { label: "Spain", keys: ["spain","madrid","espana"] },
            { label: "Netherlands", keys: ["netherlands","amsterdam","nederland"] },
            { label: "Australia", keys: ["australia","adelaide","sydney","brisbane","new south wales","queensland"] },
            { label: "Singapore", keys: ["singapore","新加坡","central region","中区"] },
            { label: "Malaysia", keys: ["malaysia","pahang","bentong","kuala lumpur"] },
            { label: "Thailand", keys: ["thailand","bangkok","ประเทศไทย","กรุงเทพมหานคร"] },
            { label: "Indonesia", keys: ["indonesia"] },
            { label: "Vietnam", keys: ["viet nam","vietnam","ho chi minh","ha noi","can tho"] },
            { label: "South Korea", keys: ["south korea","korea","韩国","대한민국","부산","파주시"] },
            { label: "Macao S.A.R", keys: ["macau","macao","澳门"] },
            { label: "Colombia", keys: ["colombia","bogota"] },
            { label: "Argentina", keys: ["argentina"] },
            { label: "Peru", keys: ["peru","lima"] },
            { label: "Chile", keys: ["chile"] },
            { label: "Philippines", keys: ["philippines"] },
            { label: "India", keys: ["india"] }
          ];
          return rules.concat(this.customMapRules);
        },

        classifyLocation(location) {
          const loc = this.normalizeLocation(location);
          if (!loc) return "";
          const rule = this.getLocationRules().find((item) => item.keys.some((key) => loc.includes(this.normalizeLocation(key))));
          return rule ? rule.label : "";
        },

        guessCountryForLocation(location) {
          const loc = this.normalizeLocation(location);
          if (!loc) return "";
          const guesses = [
            ["China", ["中国大陆","中国","中华人民","北京","上海","广州","深圳","成都","杭州","重庆","武汉","天津","江苏","广东","浙江","辽宁","山东","福建","四川","广西","湖北","湖南","江西","安徽","陕西","贵州","云南","山西","内蒙古"]],
            ["Taiwan", ["台灣","台湾","台北","台中","高雄","新北","桃園"]],
            ["Hong Kong S.A.R.", ["香港","灣仔","九龙","九龍"]],
            ["Japan", ["日本","東京","大阪","神奈","関東","熊本"]],
            ["South Korea", ["韩国","대한민국","부산","파주"]],
            ["Thailand", ["ประเทศไทย","กรุงเทพ"]],
            ["Vietnam", ["việt","vietnam","hồ chí minh","hà nội","cần thơ"]],
            ["United States of America", ["usa","america","california","new york","washington","florida","georgia","texas","dc"]],
            ["Mexico", ["méxico","mexico","cdmx","jalisco","distrito federal"]],
            ["Brazil", ["brasil","brazil"]],
            ["Singapore", ["singapore","新加坡"]],
            ["Malaysia", ["malaysia","pahang"]],
            ["Canada", ["canada","quebec","ontario"]],
            ["Australia", ["australia","sydney","brisbane","adelaide"]],
            ["United Kingdom", ["england","united kingdom","london","uk"]],
            ["Germany", ["frankfurt","germany","hessen","hesse"]],
            ["France", ["france","paris"]],
            ["Colombia", ["colombia","bogota"]],
            ["Peru", ["peru","lima"]]
          ];
          const match = guesses.find(([, keys]) => keys.some((key) => loc.includes(this.normalizeLocation(key))));
          return match ? match[0] : "";
        },

        computeMapBuckets(points) {
          const buckets = new Map();
          const unmatched = new Map();
          points.forEach((p) => {
            const locRaw = String(p.location || "").trim();
            const label = this.classifyLocation(locRaw);
            if (!locRaw) return;
            if (!label) {
              const currentMiss = unmatched.get(locRaw) || { location: locRaw, count: 0, suggested: this.guessCountryForLocation(locRaw) };
              currentMiss.count += 1;
              unmatched.set(locRaw, currentMiss);
              return;
            }
            const current = buckets.get(label) || { label, count: 0 };
            current.count += 1;
            buckets.set(label, current);
          });
          return {
            buckets: Array.from(buckets.values()).sort((a, b) => b.count - a.count),
            unmatched: Array.from(unmatched.values()).sort((a, b) => b.count - a.count)
          };
        },

        buildGeometryPath(geometry, width, height) {
          if (!geometry) return;
          const path = new Path2D();
          const drawRing = (ring) => {
            ring.forEach((coord, index) => {
              const { x, y } = this.projectLonLat(coord[0], coord[1], width, height);
              if (index === 0) path.moveTo(x, y);
              else path.lineTo(x, y);
            });
            path.closePath();
          };
          if (geometry.type === "Polygon") {
            geometry.coordinates.forEach(drawRing);
          } else if (geometry.type === "MultiPolygon") {
            geometry.coordinates.forEach((polygon) => polygon.forEach(drawRing));
          }
          return path;
        },

        onMapHover(event) {
          const canvas2 = els.mapCanvas;
          const ctx2 = canvas2.getContext("2d");
          const rect = canvas2.getBoundingClientRect();
          const x = (event.clientX - rect.left) * (canvas2.width / rect.width);
          const y = (event.clientY - rect.top) * (canvas2.height / rect.height);
          let hit = null;
          for (const shape of this.lastMapShapes) {
            if (ctx2.isPointInPath(shape.path, x, y)) {
              hit = shape;
              break;
            }
          }
          if (!hit) return this.clearMapHover();
          els.mapTooltip.innerHTML = `<strong>${this.escapeHtml(hit.name)}</strong><br>${this.t("hoverHitCount", { count: this.formatNum(hit.count) })}`;
          els.mapTooltip.style.opacity = "1";
          els.mapTooltip.style.transform = `translate(${event.clientX - rect.left + 16}px, ${event.clientY - rect.top + 16}px)`;
        },

        clearMapHover() {
          els.mapTooltip.style.opacity = "0";
          els.mapTooltip.style.transform = "translate(-9999px, -9999px)";
        },

        onMapClick(event) {
          const canvas2 = els.mapCanvas;
          const ctx2 = canvas2.getContext("2d");
          const rect = canvas2.getBoundingClientRect();
          const x = (event.clientX - rect.left) * (canvas2.width / rect.width);
          const y = (event.clientY - rect.top) * (canvas2.height / rect.height);
          let hit = null;
          for (const shape of this.lastMapShapes) {
            if (ctx2.isPointInPath(shape.path, x, y)) {
              hit = shape;
              break;
            }
          }
          if (!hit) return;
          this.state.countryFilter = hit.name;
          this.state.activePanel = "accounts";
          this.syncControls();
          this.renderActivePanel();
          this.renderTable();
        },

        onMapSuggestionClick(event) {
          const btn = event.target.closest("button[data-location][data-country]");
          if (!btn) return;
          const location = btn.getAttribute("data-location") || "";
          const country = btn.getAttribute("data-country") || "";
          if (!location || !country) return;
          const normalized = this.normalizeLocation(location);
          if (!normalized) return;
          this.customMapRules.push({ label: country, keys: [normalized] });
          const mapResult = this.computeMapBuckets(this.allPoints || []);
          this.mapBuckets = mapResult.buckets;
          this.mapUnmatched = mapResult.unmatched;
          this.renderMapArea();
          if (this.state.countryFilter !== "all") this.renderTable();
        },

        projectLonLat(lon, lat, width, height) {
          const x = ((lon + 180) / 360) * (width - 48) + 24;
          const y = ((90 - lat) / 180) * (height - 48) + 24;
          return { x, y };
        },

        renderChart() {
          const width = canvas.width;
          const height = canvas.height;
          const pad = { l: 70, r: 24, t: 20, b: 52 };
          const innerW = width - pad.l - pad.r;
          const innerH = height - pad.t - pad.b;
          const maxFollowers = Math.max(...this.allPoints.map((p) => p.followers), 1);
          const maxFollowing = Math.max(...this.allPoints.map((p) => p.following), 1);
          const maxXF = Math.log10(maxFollowers + 1);
          const maxYF = Math.log10(maxFollowing + 1);
          const xScale = (v) => pad.l + (Math.log10(v + 1) / maxXF) * innerW;
          const yScale = (v) => height - pad.b - (Math.log10(v + 1) / maxYF) * innerH;

          ctx.clearRect(0, 0, width, height);
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, width, height);

          ctx.strokeStyle = "#e6efeb";
          ctx.lineWidth = 1;
          const ticks = [1, 10, 100, 1000, 10000, 100000, 500000];
          ticks.forEach((t) => {
            const x = xScale(t);
            const y = yScale(t);
            ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, height - pad.b); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(width - pad.r, y); ctx.stroke();
          });

          ctx.strokeStyle = "#94a7a1";
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(pad.l, pad.t);
          ctx.lineTo(pad.l, height - pad.b);
          ctx.lineTo(width - pad.r, height - pad.b);
          ctx.stroke();

          ctx.fillStyle = "#61706b";
          ctx.font = "12px Segoe UI";
          ticks.forEach((t) => {
            const x = xScale(t);
            const y = yScale(t);
            ctx.textAlign = "center";
            ctx.fillText(this.formatTick(t), x, height - 28);
            ctx.textAlign = "right";
            ctx.fillText(this.formatTick(t), pad.l - 10, y + 4);
          });

          ctx.save();
          ctx.translate(width / 2, height - 10);
          ctx.textAlign = "center";
          ctx.fillText(this.t("scatterXAxis"), 0, 0);
          ctx.restore();

          ctx.save();
          ctx.translate(16, height / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = "center";
          ctx.fillText(this.t("scatterYAxis"), 0, 0);
          ctx.restore();

          const topSet = new Set(this.topFans.map((p) => p.screen_name));
          this.lastDrawnPoints = [];

          this.visiblePoints.forEach((p) => {
            const x = xScale(p.followers);
            const y = yScale(p.following);
            const isTop = this.state.highlightTop && topSet.has(p.screen_name);
            const radius = isTop ? 5.8 : 3.2;
            const color = p.bot_bucket === "high"
              ? "rgba(182,75,51,0.65)"
              : p.bot_bucket === "medium"
                ? "rgba(183,136,40,0.68)"
                : "rgba(13,124,102,0.58)";

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            if (isTop) {
              ctx.lineWidth = 2;
              ctx.strokeStyle = "#f0c341";
              ctx.stroke();
            }
            this.lastDrawnPoints.push({ x, y, p, radius });
          });

          if (this.state.selection) {
            const { x1, y1, x2, y2 } = this.state.selection;
            const left = Math.min(x1, x2);
            const top = Math.min(y1, y2);
            const widthBox = Math.abs(x2 - x1);
            const heightBox = Math.abs(y2 - y1);
            ctx.save();
            ctx.fillStyle = "rgba(13,124,102,0.12)";
            ctx.strokeStyle = "rgba(13,124,102,0.85)";
            ctx.lineWidth = 1.5;
            ctx.fillRect(left, top, widthBox, heightBox);
            ctx.strokeRect(left, top, widthBox, heightBox);
            ctx.restore();
          }
        },

        onHover(event) {
          if (this.isSelecting) return;
          const rect = canvas.getBoundingClientRect();
          const x = (event.clientX - rect.left) * (canvas.width / rect.width);
          const y = (event.clientY - rect.top) * (canvas.height / rect.height);
          let best = null;
          let bestDist = 999999;
          this.lastDrawnPoints.forEach((d) => {
            const dx = d.x - x;
            const dy = d.y - y;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist && dist < 180) {
              bestDist = dist;
              best = d;
            }
          });
          if (!best) return this.clearHover();
          tooltip.innerHTML = `
            <strong>@${this.escapeHtml(best.p.screen_name)}</strong><br>
            ${this.t("hoverFollowers", { count: this.formatNum(best.p.followers) })}<br>
            ${this.t("hoverFollowing", { count: this.formatNum(best.p.following) })}<br>
            ${this.t("hoverStatuses", { count: this.formatNum(best.p.statuses) })}<br>
            ${this.t("hoverRisk", { bucket: best.p.bot_bucket, score: best.p.bot_score })}
          `;
          tooltip.style.opacity = "1";
          tooltip.style.transform = `translate(${event.clientX - rect.left + 16}px, ${event.clientY - rect.top + 16}px)`;
        },

        clearHover() {
          tooltip.style.opacity = "0";
          tooltip.style.transform = "translate(-9999px, -9999px)";
        },

        startSelection(event) {
          if (event.button !== 0) return;
          const rect = canvas.getBoundingClientRect();
          const x = (event.clientX - rect.left) * (canvas.width / rect.width);
          const y = (event.clientY - rect.top) * (canvas.height / rect.height);
          this.isSelecting = true;
          this.state.selection = { x1: x, y1: y, x2: x, y2: y };
          this.state.selectionPage = 1;
          this.clearHover();
          this.renderChart();
          this.renderSelectionTable();
        },

        moveSelection(event) {
          if (!this.isSelecting || !this.state.selection) return;
          const rect = canvas.getBoundingClientRect();
          const rawX = (event.clientX - rect.left) * (canvas.width / rect.width);
          const rawY = (event.clientY - rect.top) * (canvas.height / rect.height);
          const x = Math.max(0, Math.min(canvas.width, rawX));
          const y = Math.max(0, Math.min(canvas.height, rawY));
          this.state.selection.x2 = x;
          this.state.selection.y2 = y;
          this.state.selectionPage = 1;
          this.renderChart();
          this.renderSelectionTable();
        },

        endSelection() {
          if (!this.isSelecting) return;
          this.isSelecting = false;
          this.renderChart();
          this.renderSelectionTable();
        },

        downloadCsv(rows, filename) {
          const headers = ["screen_name","name","profile_url","location","followers","following","statuses","age_days","bot_bucket","bot_score","real_score","reasons"];
          const csv = [
            headers.join(","),
            ...rows.map((row) => headers.map((key) => this.csvCell(key === "reasons" ? (row[key] || []).join("|") : row[key])).join(","))
          ].join("\r\n");
          const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        },

        renderBars(rows) {
          const max = Math.max(...rows.map((row) => row.count || 0), 1);
          return rows.map((row) => `
            <div class="bar-row">
              <div class="bar-label">${this.escapeHtml(row.label)}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${((row.count || 0) * 100 / max).toFixed(1)}%"></div></div>
              <div class="bar-value">${this.formatNum(row.count || 0)}</div>
            </div>
          `).join("");
        },

        drawDonutChart(canvasNode, rows) {
          if (!canvasNode) return;
          const ctx = canvasNode.getContext("2d");
          const width = canvasNode.width;
          const height = canvasNode.height;
          const total = Math.max(rows.reduce((sum, row) => sum + (row.count || 0), 0), 1);
          const cx = width / 2;
          const cy = height / 2;
          const radius = Math.min(width, height) / 2 - 8;
          const innerRadius = radius * 0.62;
          let start = -Math.PI / 2;
          ctx.clearRect(0, 0, width, height);
          rows.forEach((row, index) => {
            const value = row.count || 0;
            if (!value) return;
            const angle = (value / total) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, start, start + angle);
            ctx.closePath();
            ctx.fillStyle = this.getDonutColor(index);
            ctx.fill();
            start += angle;
          });
          ctx.globalCompositeOperation = "destination-out";
          ctx.beginPath();
          ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        },

        getDonutColor(index) {
          const palette = ["#0d7c66", "#31b394", "#b78828", "#dfb35a", "#b64b33", "#e68c74", "#6f8f86", "#9bb8b0"];
          return palette[index % palette.length];
        },

        formatTick(value) {
          if (value >= 1000) return (value / 1000) + "k";
          return String(value);
        },

        riskBucketLabel(bucket) {
          if (bucket === "low") return this.t("riskLowOnly").replace(/^仅|僅|Solo /, "").replace(/ only$/, "");
          if (bucket === "medium") return this.t("riskMediumOnly").replace(/^仅|僅|Solo /, "").replace(/ only$/, "");
          if (bucket === "high") return this.t("riskHighOnly").replace(/^仅|僅|Solo /, "").replace(/ only$/, "");
          return bucket || "-";
        },

        formatNum(value) {
          const meta = LANGUAGE_META.en || { html: "en", locale: "en-US" };
          return Number(value || 0).toLocaleString(meta.locale);
        },

        formatPct(value) {
          return (value * 100).toFixed(1) + "%";
        },

        csvCell(value) {
          const text = String(value ?? "");
          return "\"" + text.replaceAll("\"", "\"\"") + "\"";
        },

        escapeHtml(value) {
          return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;");
        }
      };

      vm.init().catch((error) => {
        console.error(error);
        document.body.innerHTML = "<div style='padding:40px;font-family:Segoe UI,Microsoft YaHei,sans-serif'>加载 SQLite 数据库失败。</div>";
      });
      window.reportViewModel = vm;
    }());

