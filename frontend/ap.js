/**
 * NovaShop – Full Sales System
 * All logic consolidated in a single file.
 * Connects to AWS API Gateway + Lambda + DynamoDB (or any DB).
 */

(function() {
    'use strict';

    // ============================================================
    //  CONFIGURATION (set in frontend/config.js after `sam deploy`)
    // ============================================================
    const CFG = window.NOVA_CONFIG || {};
    const API_BASE = CFG.apiBaseUrl || '';
    const COGNITO_REGION = CFG.region || (CFG.userPoolId || '').split('_')[0] || '';
    const COGNITO_CLIENT_ID = CFG.clientId || '';
    const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

    let authToken = null;       // Cognito ID token (JWT) — sent as Bearer
    let refreshToken = null;    // used for silent re-auth
    let tokenExpiresAt = 0;     // epoch ms

    // ============================================================
    //  STATE
    // ============================================================
    let products = [];
    let cart = [];
    let orders = [];
    let currentUser = null;

    // ============================================================
    //  DOM REFS
    // ============================================================
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

    const loginPage = $('#loginPage');
    const app = $('#app');
    const loginForm = $('#loginForm');
    const usernameInput = $('#usernameInput');
    const passwordInput = $('#passwordInput');
    const loginError = $('#loginError');

    const navTabs = $$('.nav-tab');
    const views = {
        dashboard: $('#view-dashboard'),
        products: $('#view-products'),
        cart: $('#view-cart'),
        orders: $('#view-orders'),
        about: $('#view-about'),
    };
    const productGrid = $('#productGrid');
    const cartItems = $('#cartItems');
    const cartSummary = $('#cartSummary');
    const cartCount = $('#cartCount');
    const cartSubtotal = $('#cartSubtotal');
    const cartTax = $('#cartTax');
    const cartTotal = $('#cartTotal');
    const checkoutBtn = $('#checkoutBtn');
    const searchInput = $('#searchInput');
    const categoryFilter = $('#categoryFilter');
    const recentOrders = $('#recentOrders');
    const ordersList = $('#ordersList');
    const statRevenue = $('#statRevenue');
    const statOrders = $('#statOrders');
    const statSold = $('#statSold');
    const statCustomers = $('#statCustomers');
    const userNameSpan = $('#userName');
    const signOutBtn = $('#signOutBtn');

    const modal = $('#checkoutModal');
    const modalTotal = $('#modalTotal');
    const modalItemCount = $('#modalItemCount');
    const modalCancel = $('#modalCancel');
    const modalConfirm = $('#modalConfirm');

    const toastContainer = $('#toastContainer');

    // Product CRUDL modal refs
    const addProductBtn = $('#addProductBtn');
    const productModal = $('#productModal');
    const productModalTitle = $('#productModalTitle');
    const productForm = $('#productForm');
    const productIdInput = $('#productIdInput');
    const productNameInput = $('#productNameInput');
    const productCategoryInput = $('#productCategoryInput');
    const productEmojiInput = $('#productEmojiInput');
    const productPriceInput = $('#productPriceInput');
    const productStockInput = $('#productStockInput');
    const productImageInput = $('#productImageInput');
    const productError = $('#productError');
    const productModalCancel = $('#productModalCancel');
    const productModalSave = $('#productModalSave');

    // Delete confirmation modal refs
    const confirmModal = $('#confirmModal');
    const confirmModalText = $('#confirmModalText');
    const confirmCancel = $('#confirmCancel');
    const confirmOk = $('#confirmOk');

    // ============================================================
    //  TOAST NOTIFICATIONS
    // ============================================================
    function toast(message, type = 'info', duration = 3000) {
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
        el.innerHTML = `
            <i class="fas ${icons[type] || icons.info}"></i>
            <span>${message}</span>
            <span class="toast-close">&times;</span>
        `;
        toastContainer.appendChild(el);
        const close = el.querySelector('.toast-close');
        close.addEventListener('click', () => el.remove());
        setTimeout(() => { if (el.parentNode) el.remove(); }, duration);
    }

    // ============================================================
    //  LOCAL STORAGE (session & cart persistence)
    // ============================================================
    function loadData() {
        try {
            const saved = localStorage.getItem('novashop_data');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.cart) cart = parsed.cart;
                if (parsed.currentUser) currentUser = parsed.currentUser;
                if (parsed.session) {
                    authToken = parsed.session.idToken;
                    refreshToken = parsed.session.refreshToken;
                    tokenExpiresAt = parsed.session.expiresAt || 0;
                }
            }
        } catch (_) { /* ignore */ }
    }

    function saveData() {
        try {
            localStorage.setItem('novashop_data', JSON.stringify({
                cart,
                currentUser,
                session: authToken ? { idToken: authToken, refreshToken, expiresAt: tokenExpiresAt } : null,
            }));
        } catch (_) { /* ignore */ }
    }

    // ============================================================
    //  API HELPERS
    // ============================================================
    async function apiFetch(endpoint, options = {}, retried = false) {
        // Proactively refresh an expired ID token.
        if (authToken && Date.now() > tokenExpiresAt - 30000 && refreshToken && !retried) {
            await refreshSession();
        }
        const url = `${API_BASE}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
            ...options.headers,
        };
        const response = await fetch(url, { ...options, headers });
        if (response.status === 401 && !retried && refreshToken) {
            if (await refreshSession()) return apiFetch(endpoint, options, true);
        }
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP ${response.status}`);
        }
        return response.json();
    }

    // ============================================================
    //  AMAZON COGNITO AUTH (via the Cognito Identity Provider API)
    // ============================================================
    function cognitoCall(operation, payload) {
        return fetch(COGNITO_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': `AWSCognitoIdentityProviderService.${operation}`,
            },
            body: JSON.stringify(payload),
        }).then(async (r) => {
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data.message || `Cognito error ${r.status}`);
            return data;
        });
    }

    function decodeJwtPayload(token) {
        try {
            const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(decodeURIComponent(escape(atob(b64))));
        } catch (_) { return {}; }
    }

    function adoptSession(result) {
        const auth = result.AuthenticationResult || {};
        authToken = auth.IdToken;
        if (auth.RefreshToken) refreshToken = auth.RefreshToken;
        tokenExpiresAt = Date.now() + (auth.ExpiresIn || 3600) * 1000;
        const claims = decodeJwtPayload(authToken);
        currentUser = {
            id: claims.sub || '',
            username: claims['cognito:username'] || claims.email || 'user',
        };
    }

    async function refreshSession() {
        if (!refreshToken) return false;
        try {
            const result = await cognitoCall('InitiateAuth', {
                AuthFlow: 'REFRESH_TOKEN_AUTH',
                ClientId: COGNITO_CLIENT_ID,
                AuthParameters: { REFRESH_TOKEN: refreshToken },
            });
            adoptSession(result);
            saveData();
            return true;
        } catch (_) {
            return false;
        }
    }

    async function login(username, password) {
        try {
            const result = await cognitoCall('InitiateAuth', {
                AuthFlow: 'USER_PASSWORD_AUTH',
                ClientId: COGNITO_CLIENT_ID,
                AuthParameters: { USERNAME: username, PASSWORD: password },
            });
            adoptSession(result);
            saveData();
            showApp();
            loginError.textContent = '';
            toast(`Welcome back, ${currentUser.username}!`, 'success');
            return true;
        } catch (err) {
            loginError.textContent = err.message || 'Invalid credentials';
            return false;
        }
    }

    async function logout() {
        if (refreshToken) {
            await cognitoCall('RevokeToken', { ClientId: COGNITO_CLIENT_ID, Token: refreshToken }).catch(() => {});
        }
        currentUser = null;
        authToken = null;
        refreshToken = null;
        tokenExpiresAt = 0;
        saveData();
        showLogin();
        toast('Signed out.', 'info');
    }

    // ============================================================
    //  UI SWITCHING (Login / App)
    // ============================================================
    function showApp() {
        loginPage.style.display = 'none';
        app.classList.add('active');
        userNameSpan.textContent = currentUser.username.charAt(0).toUpperCase() + currentUser.username.slice(1);
        // Load data from server
        loadProducts();
        loadOrders();
        renderCart(); // cart is local
        switchView('dashboard');
    }

    function showLogin() {
        loginPage.style.display = 'flex';
        app.classList.remove('active');
    }

    // ============================================================
    //  NAVIGATION
    // ============================================================
    function switchView(viewName) {
        navTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === viewName);
        });
        Object.keys(views).forEach(key => {
            views[key].classList.toggle('active', key === viewName);
        });
        if (viewName === 'cart') renderCart();
        if (viewName === 'dashboard') renderDashboard();
        if (viewName === 'orders') renderOrders();
        modal.classList.remove('open');
    }

    // ============================================================
    //  PRODUCTS
    // ============================================================
    async function loadProducts() {
        try {
            products = await apiFetch('/products');
            renderProducts();
        } catch (err) {
            toast('Failed to load products: ' + err.message, 'error');
        }
    }

    function renderProducts(filter = '') {
        const cat = categoryFilter.value;
        const term = filter.toLowerCase().trim();

        let filtered = products.filter(p => {
            const matchCat = cat === 'all' || p.category === cat;
            const matchTerm = p.name.toLowerCase().includes(term) ||
                p.category.toLowerCase().includes(term);
            return matchCat && matchTerm;
        });

        if (!filtered.length) {
            productGrid.innerHTML = `
                <div style="grid-column:1/-1;text-align:center;padding:48px 0;color:var(--gray-400);">
                    <i class="fas fa-search" style="font-size:2rem;display:block;margin-bottom:12px;"></i>
                    No products found.
                </div>`;
            return;
        }

        productGrid.innerHTML = filtered.map(p => {
            const inCart = cart.find(c => c.id === p.id);
            const qtyInCart = inCart ? inCart.qty : 0;
            const lowStock = p.stock <= 3;
            const priceNum = Number(p.price);
            const visual = p.imageUrl
                ? `<img class="product-img" src="${p.imageUrl}" alt="${p.name}" onerror="this.style.display='none'">`
                : `<div class="emoji">${p.emoji}</div>`;
            const safeName = String(p.name).replace(/"/g, '&quot;').replace(/'/g, "\\'");
            return `
                <div class="product-card">
                    ${visual}
                    <div class="name">${p.name}</div>
                    <div class="category">${p.category}</div>
                    <div class="price">$${priceNum.toFixed(2)}</div>
                    <div class="stock ${lowStock ? 'low' : ''}">${p.stock} in stock</div>
                    <div class="actions">
                        ${qtyInCart > 0 ? `
                            <button class="btn btn-outline btn-sm" onclick="updateCartQty('${p.id}', -1)" ${p.stock <= 0 ? 'disabled' : ''}>
                                <i class="fas fa-minus"></i>
                            </button>
                            <span style="font-weight:600;padding:0 4px;min-width:24px;text-align:center;">${qtyInCart}</span>
                            <button class="btn btn-outline btn-sm" onclick="updateCartQty('${p.id}', 1)" ${p.stock <= qtyInCart ? 'disabled' : ''}>
                                <i class="fas fa-plus"></i>
                            </button>
                        ` : `
                            <button class="btn btn-primary btn-sm" onclick="addToCart('${p.id}')" ${p.stock <= 0 ? 'disabled' : ''}>
                                <i class="fas fa-cart-plus"></i> Add
                            </button>
                        `}
                    </div>
                    <div class="actions manage-actions">
                        <button class="btn btn-outline btn-sm" onclick="editProduct('${p.id}')">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="requestDeleteProduct('${p.id}', '${safeName}')">
                            <i class="fas fa-trash-alt"></i> Delete
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Exposed for inline onclick
    window.addToCart = function(productId) {
        const product = products.find(p => p.id === productId);
        if (!product) return;
        if (product.stock <= 0) {
            toast('Out of stock!', 'error');
            return;
        }
        const existing = cart.find(c => c.id === productId);
        if (existing) {
            if (existing.qty >= product.stock) {
                toast('Not enough stock!', 'error');
                return;
            }
            existing.qty += 1;
        } else {
            cart.push({ ...product, qty: 1 });
        }
        saveData();
        renderCart();
        renderProducts(searchInput.value);
        toast(`Added ${product.name} to cart`, 'success');
    };

    window.updateCartQty = function(productId, delta) {
        const product = products.find(p => p.id === productId);
        if (!product) return;
        const item = cart.find(c => c.id === productId);
        if (!item) return;
        const newQty = item.qty + delta;
        if (newQty <= 0) {
            cart = cart.filter(c => c.id !== productId);
            toast(`Removed ${product.name} from cart`, 'info');
        } else if (newQty > product.stock) {
            toast('Not enough stock!', 'error');
            return;
        } else {
            item.qty = newQty;
        }
        saveData();
        renderCart();
        renderProducts(searchInput.value);
    };

    // ============================================================
    //  PRODUCTS — CRUDL OPERATIONS (API Gateway → Lambda → DynamoDB/S3)
    // ============================================================
    async function loadProducts() {
        try {
            products = await apiFetch('/products');
            renderProducts();
        } catch (err) {
            toast('Failed to load products: ' + err.message, 'error');
        }
    }

    async function createProduct(payload) {
        return apiFetch('/products', { method: 'POST', body: JSON.stringify(payload) });
    }

    async function updateProduct(id, payload) {
        return apiFetch(`/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
    }

    async function deleteProduct(id) {
        return apiFetch(`/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }

    /** Get a pre-signed S3 PUT URL, then upload the file directly to S3. */
    async function uploadProductImage(file) {
        const pres = await apiFetch('/images/presign', {
            method: 'POST',
            body: JSON.stringify({ fileName: file.name, contentType: file.type }),
        });
        const upload = await fetch(pres.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file,
        });
        if (!upload.ok) throw new Error(`S3 upload failed (HTTP ${upload.status})`);
        return pres.key;
    }

    // ---------- Product modal ----------
    function openProductModal(product = null) {
        productError.textContent = '';
        productImageInput.value = '';
        productIdInput.value = product ? product.id : '';
        productModalTitle.innerHTML = product
            ? '<i class="fas fa-edit" style="color:var(--primary);margin-right:10px;"></i>Edit Product'
            : '<i class="fas fa-plus-circle" style="color:var(--primary);margin-right:10px;"></i>Add Product';
        productNameInput.value = product ? product.name : '';
        productCategoryInput.value = product ? product.category : 'Electronics';
        productEmojiInput.value = product && product.emoji ? product.emoji : '';
        productPriceInput.value = product ? product.price : '';
        productStockInput.value = product ? product.stock : '';
        productModal.classList.add('open');
    }

    function closeProductModal() {
        productModal.classList.remove('open');
    }

    addProductBtn.addEventListener('click', () => openProductModal());
    productModalCancel.addEventListener('click', closeProductModal);
    productModal.addEventListener('click', (e) => { if (e.target === productModal) closeProductModal(); });

    productForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        productError.textContent = '';
        const id = productIdInput.value;
        const payload = {
            name: productNameInput.value.trim(),
            category: productCategoryInput.value,
            emoji: productEmojiInput.value.trim() || '📦',
            price: parseFloat(productPriceInput.value),
            stock: parseInt(productStockInput.value, 10),
        };
        if (!payload.name || !Number.isFinite(payload.price) || !Number.isInteger(payload.stock)) {
            productError.textContent = 'Please provide a valid name, price and stock.';
            return;
        }
        try {
            productModalSave.disabled = true;
            const file = productImageInput.files[0];
            if (file) payload.imageKey = await uploadProductImage(file);
            if (id) {
                await updateProduct(id, payload);
                toast('Product updated ✔', 'success');
            } else {
                await createProduct(payload);
                toast('Product created ✔', 'success');
            }
            closeProductModal();
            await loadProducts();
            renderProducts(searchInput.value);
        } catch (err) {
            productError.textContent = err.message || 'Save failed';
        } finally {
            productModalSave.disabled = false;
        }
    });

    // ---------- Delete flow ----------
    let pendingDeleteId = null;

    window.requestDeleteProduct = function(id, name) {
        pendingDeleteId = id;
        confirmModalText.innerHTML = `Delete <b>"${name}"</b>? This removes it from DynamoDB and its image from S3.`;
        confirmModal.classList.add('open');
    };

    function closeConfirmModal() {
        confirmModal.classList.remove('open');
        pendingDeleteId = null;
    }

    confirmCancel.addEventListener('click', closeConfirmModal);
    confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) closeConfirmModal(); });

    confirmOk.addEventListener('click', async () => {
        if (!pendingDeleteId) return closeConfirmModal();
        try {
            confirmOk.disabled = true;
            await deleteProduct(pendingDeleteId);
            toast('Product deleted', 'success');
            closeConfirmModal();
            await loadProducts();
            renderProducts(searchInput.value);
        } catch (err) {
            toast('Delete failed: ' + err.message, 'error');
            closeConfirmModal();
        } finally {
            confirmOk.disabled = false;
        }
    });

    window.editProduct = function(id) {
        const product = products.find(p => p.id === id);
        if (product) openProductModal(product);
    };

    // ============================================================
    //  CART
    // ============================================================
    function renderCart() {
        const count = cart.reduce((sum, c) => sum + c.qty, 0);
        cartCount.textContent = count;

        if (!cart.length) {
            cartItems.innerHTML = `
                <div class="empty">
                    <i class="fas fa-shopping-cart"></i>
                    <p>Your cart is empty.</p>
                    <button class="btn btn-primary btn-sm mt-12" onclick="switchView('products')">
                        <i class="fas fa-arrow-left"></i> Browse Products
                    </button>
                </div>
            `;
            checkoutBtn.disabled = true;
            cartSubtotal.textContent = '$0.00';
            cartTax.textContent = '$0.00';
            cartTotal.textContent = '$0.00';
            return;
        }

        let html = '';
        let subtotal = 0;
        cart.forEach(item => {
            const total = item.price * item.qty;
            subtotal += total;
            html += `
                <div class="cart-item">
                    <div class="emoji">${item.emoji}</div>
                    <div class="info">
                        <div class="name">${item.name}</div>
                        <div class="price">$${Number(item.price).toFixed(2)}</div>
                    </div>
                    <div class="qty-control">
                        <button onclick="updateCartQty('${item.id}', -1)"><i class="fas fa-minus"></i></button>
                        <span>${item.qty}</span>
                        <button onclick="updateCartQty('${item.id}', 1)" ${item.qty >= (products.find(p=>p.id===item.id)?.stock || 0) ? 'disabled' : ''}>
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <div class="item-total">$${total.toFixed(2)}</div>
                    <button class="remove-btn" onclick="updateCartQty('${item.id}', -${item.qty})"><i class="fas fa-trash-alt"></i></button>
                </div>
            `;
        });

        cartItems.innerHTML = html;
        checkoutBtn.disabled = false;

        const tax = subtotal * 0.10;
        const total = subtotal + tax;
        cartSubtotal.textContent = `$${subtotal.toFixed(2)}`;
        cartTax.textContent = `$${tax.toFixed(2)}`;
        cartTotal.textContent = `$${total.toFixed(2)}`;
    }

    // ============================================================
    //  CHECKOUT (Place Order)
    // ============================================================
    checkoutBtn.addEventListener('click', () => {
        if (!cart.length) return;
        const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
        const tax = total * 0.10;
        const grand = total + tax;
        modalTotal.textContent = `$${grand.toFixed(2)}`;
        const count = cart.reduce((s, c) => s + c.qty, 0);
        modalItemCount.textContent = `${count} items`;
        modal.classList.add('open');
    });

    modalCancel.addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
    });

    modalConfirm.addEventListener('click', async () => {
        if (!cart.length) return;
        const orderPayload = {
            items: cart.map(item => ({
                productId: item.id,
                quantity: item.qty,
                price: item.price,
                name: item.name,
                emoji: item.emoji,
            })),
        };
        try {
            const newOrder = await apiFetch('/orders', {
                method: 'POST',
                body: JSON.stringify(orderPayload),
            });
            // Update local orders and cart
            orders.unshift(newOrder); // or re-fetch orders
            cart = [];
            saveData();
            renderCart();
            renderOrders();
            renderDashboard();
            modal.classList.remove('open');
            toast(`Order #${newOrder.id} placed successfully! 🎉`, 'success');
            // Refresh product stock from server
            await loadProducts();
            // Switch to orders view
            switchView('orders');
        } catch (err) {
            toast('Failed to place order: ' + err.message, 'error');
        }
    });

    // ============================================================
    //  ORDERS
    // ============================================================
    async function loadOrders() {
        try {
            orders = await apiFetch('/orders');
            renderOrders();
            renderDashboard();
        } catch (err) {
            toast('Failed to load orders: ' + err.message, 'error');
        }
    }

    function renderOrders() {
        if (!orders.length) {
            ordersList.innerHTML = `
                <div class="empty">
                    <i class="fas fa-receipt" style="font-size:2.4rem;display:block;margin-bottom:12px;color:var(--gray-300);"></i>
                    <p>No orders placed yet.</p>
                </div>
            `;
            return;
        }
        const sorted = [...orders].reverse();
        ordersList.innerHTML = sorted.map(o => {
            const itemCount = o.items.reduce((s, i) => s + i.quantity, 0);
            const date = new Date(o.date);
            const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const statusClass = o.status === 'completed' ? 'status-completed' :
                               o.status === 'pending' ? 'status-pending' : 'status-cancelled';
            return `
                <div class="order-item">
                    <div class="left">
                        <div class="id">Order #${o.id}</div>
                        <div class="meta">${dateStr} · ${itemCount} items</div>
                    </div>
                    <div class="right">
                        <span class="status ${statusClass}">${o.status}</span>
                        <span class="total">$${o.total.toFixed(2)}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ============================================================
    //  DASHBOARD
    // ============================================================
    function renderDashboard() {
        const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
        const totalOrders = orders.length;
        const totalSold = orders.reduce((sum, o) =>
            sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
        const customers = orders.length; // simplistic

        statRevenue.textContent = `$${totalRevenue.toFixed(2)}`;
        statOrders.textContent = totalOrders;
        statSold.textContent = totalSold;
        statCustomers.textContent = customers;

        const recent = [...orders].reverse().slice(0, 5);
        if (!recent.length) {
            recentOrders.innerHTML = `<li style="padding:24px 0;text-align:center;color:var(--gray-400);">No orders yet.</li>`;
            return;
        }
        recentOrders.innerHTML = recent.map(o => {
            const date = new Date(o.date);
            const dateStr = date.toLocaleDateString();
            return `
                <li>
                    <span><span class="order-id">#${o.id}</span> <span class="order-date">${dateStr}</span></span>
                    <span class="order-total">$${o.total.toFixed(2)}</span>
                </li>
            `;
        }).join('');
    }

    // ============================================================
    //  EVENT LISTENERS
    // ============================================================
    // Login
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        if (!username || !password) {
            loginError.textContent = 'Please fill in all fields.';
            return;
        }
        login(username, password);
    });

    // Sign out
    signOutBtn.addEventListener('click', logout);

    // Navigation
    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            switchView(tab.dataset.view);
        });
    });

    // Cart trigger
    $('#cartTrigger').addEventListener('click', () => {
        switchView('cart');
        navTabs.forEach(t => t.classList.toggle('active', t.dataset.view === 'cart'));
        Object.keys(views).forEach(key => {
            views[key].classList.toggle('active', key === 'cart');
        });
    });

    // Search & filter
    searchInput.addEventListener('input', () => renderProducts(searchInput.value));
    categoryFilter.addEventListener('change', () => renderProducts(searchInput.value));

    // ============================================================
    //  INITIALIZATION
    // ============================================================
    loadData();

    async function init() {
        // Silently refresh an expired Cognito session if possible.
        if (currentUser && authToken && Date.now() > tokenExpiresAt - 30000 && refreshToken) {
            const ok = await refreshSession();
            if (!ok) { currentUser = null; authToken = null; refreshToken = null; }
        }
        if (currentUser && authToken) {
            showApp();
        } else {
            showLogin();
        }
    }

    init();

    // Expose switchView globally for inline onclick
    window.switchView = switchView;

    // Save before unload
    window.addEventListener('beforeunload', saveData);

    console.log('🛒 NovaShop with AWS backend loaded.');
})();