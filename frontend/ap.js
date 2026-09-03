/**
 * NovaShop – Sales System with Amazon Cognito Authentication
 * Connects to Amazon Cognito User Pool & AWS API Gateway / Lambda backend.
 */

(function() {
    'use strict';

    // ============================================================
    //  AMAZON COGNITO CONFIGURATION
    // ============================================================
    const CognitoConfig = {
        region: 'us-east-1',
        userPoolId: 'us-east-1_NovaShopUserPool',
        clientId: 'novashopappclientid12345',
        useLiveCognito: false // Set to true when live AWS Cognito App Client ID is deployed
    };

    // ============================================================
    //  AMAZON COGNITO AUTHENTICATION SERVICE
    // ============================================================
    class CognitoAuthService {
        constructor(config) {
            this.config = config;
            this.endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;
            this.mockUsersKey = 'novashop_cognito_mock_users';
            this.mockCodesKey = 'novashop_cognito_mock_codes';
        }

        getMockUsers() {
            try {
                return JSON.parse(localStorage.getItem(this.mockUsersKey)) || {};
            } catch (_) {
                return {};
            }
        }

        saveMockUsers(users) {
            try {
                localStorage.setItem(this.mockUsersKey, JSON.stringify(users));
            } catch (_) {}
        }

        getMockCodes() {
            try {
                return JSON.parse(localStorage.getItem(this.mockCodesKey)) || {};
            } catch (_) {
                return {};
            }
        }

        saveMockCodes(codes) {
            try {
                localStorage.setItem(this.mockCodesKey, JSON.stringify(codes));
            } catch (_) {}
        }

        async cognitoRequest(action, payload) {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-amz-json-1.1',
                    'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || data.__type || 'Cognito authentication error');
            }
            return data;
        }

        /**
         * SignUp: Registers a new user on Amazon Cognito and sends a confirmation code.
         */
        async signUp(email, password, name) {
            const cleanEmail = email.trim().toLowerCase();
            const cleanName = name ? name.trim() : cleanEmail.split('@')[0];

            if (this.config.useLiveCognito && this.config.clientId) {
                try {
                    const res = await this.cognitoRequest('SignUp', {
                        ClientId: this.config.clientId,
                        Username: cleanEmail,
                        Password: password,
                        UserAttributes: [
                            { Name: 'email', Value: cleanEmail },
                            { Name: 'name', Value: cleanName }
                        ]
                    });
                    return { email: cleanEmail, name: cleanName, userConfirmed: res.UserConfirmed };
                } catch (err) {
                    throw err;
                }
            }

            // Amazon Cognito Local / Offline Service Simulation
            const users = this.getMockUsers();
            const code = Math.floor(100000 + Math.random() * 900000).toString();

            users[cleanEmail] = {
                email: cleanEmail,
                password: password,
                name: cleanName,
                confirmed: false,
                createdAt: new Date().toISOString()
            };
            this.saveMockUsers(users);

            const codes = this.getMockCodes();
            codes[cleanEmail] = {
                type: 'SIGNUP',
                code: code,
                createdAt: Date.now()
            };
            this.saveMockCodes(codes);

            console.log(`[Amazon Cognito] Email sent to ${cleanEmail} with confirmation code: ${code}`);
            return { email: cleanEmail, name: cleanName, userConfirmed: false, code };
        }

        /**
         * ConfirmSignUp: Confirms user registration with code.
         */
        async confirmSignUp(email, confirmationCode) {
            const cleanEmail = email.trim().toLowerCase();
            const codeInput = confirmationCode.trim();

            if (this.config.useLiveCognito && this.config.clientId) {
                await this.cognitoRequest('ConfirmSignUp', {
                    ClientId: this.config.clientId,
                    Username: cleanEmail,
                    ConfirmationCode: codeInput
                });
                return { success: true };
            }

            const users = this.getMockUsers();
            const codes = this.getMockCodes();
            const user = users[cleanEmail];
            const storedCode = codes[cleanEmail];

            if (!user) {
                throw new Error('User record not found. Please sign up first.');
            }

            // Accept generated code or fallback default '123456' for convenience
            if (storedCode && storedCode.type === 'SIGNUP') {
                if (storedCode.code !== codeInput && codeInput !== '123456') {
                    throw new Error('Invalid verification code provided.');
                }
            } else if (codeInput !== '123456') {
                throw new Error('Invalid verification code provided.');
            }

            user.confirmed = true;
            this.saveMockUsers(users);
            delete codes[cleanEmail];
            this.saveMockCodes(codes);

            return { success: true, user };
        }

        /**
         * ForgotPassword: Initiates password reset by sending a code to user email.
         */
        async forgotPassword(email) {
            const cleanEmail = email.trim().toLowerCase();

            if (this.config.useLiveCognito && this.config.clientId) {
                await this.cognitoRequest('ForgotPassword', {
                    ClientId: this.config.clientId,
                    Username: cleanEmail
                });
                return { success: true };
            }

            const users = this.getMockUsers();
            const user = users[cleanEmail];
            if (!user) {
                throw new Error('No user account found with this email address.');
            }

            const code = Math.floor(100000 + Math.random() * 900000).toString();
            const codes = this.getMockCodes();
            codes[cleanEmail] = {
                type: 'RESET',
                code: code,
                createdAt: Date.now()
            };
            this.saveMockCodes(codes);

            console.log(`[Amazon Cognito] Password reset code sent to ${cleanEmail}: ${code}`);
            return { success: true, code };
        }

        /**
         * ConfirmForgotPassword: Resets password using verification code.
         */
        async confirmForgotPassword(email, confirmationCode, newPassword) {
            const cleanEmail = email.trim().toLowerCase();
            const codeInput = confirmationCode.trim();

            if (this.config.useLiveCognito && this.config.clientId) {
                await this.cognitoRequest('ConfirmForgotPassword', {
                    ClientId: this.config.clientId,
                    Username: cleanEmail,
                    ConfirmationCode: codeInput,
                    Password: newPassword
                });
                return { success: true };
            }

            const users = this.getMockUsers();
            const codes = this.getMockCodes();
            const user = users[cleanEmail];
            const storedCode = codes[cleanEmail];

            if (!user) {
                throw new Error('User account not found.');
            }

            if (storedCode && storedCode.type === 'RESET') {
                if (storedCode.code !== codeInput && codeInput !== '123456') {
                    throw new Error('Invalid verification code.');
                }
            } else if (codeInput !== '123456') {
                throw new Error('Invalid verification code.');
            }

            user.password = newPassword;
            this.saveMockUsers(users);
            delete codes[cleanEmail];
            this.saveMockCodes(codes);

            return { success: true };
        }

        /**
         * SignIn: Authenticates user credentials via Amazon Cognito.
         */
        async signIn(emailOrUsername, password) {
            const cleanInput = emailOrUsername.trim().toLowerCase();

            if (this.config.useLiveCognito && this.config.clientId) {
                const res = await this.cognitoRequest('InitiateAuth', {
                    ClientId: this.config.clientId,
                    AuthFlow: 'USER_PASSWORD_AUTH',
                    AuthParameters: {
                        USERNAME: cleanInput,
                        PASSWORD: password
                    }
                });
                const authResult = res.AuthenticationResult;
                return {
                    token: authResult.IdToken || authResult.AccessToken,
                    username: cleanInput.includes('@') ? cleanInput.split('@')[0] : cleanInput,
                    email: cleanInput
                };
            }

            // Demo Admin account support
            if (cleanInput === 'admin' && password === 'password') {
                return {
                    token: 'mock-cognito-token-admin',
                    username: 'Admin',
                    email: 'admin@novashop.com'
                };
            }

            const users = this.getMockUsers();
            const user = users[cleanInput];

            if (!user) {
                throw new Error('User account does not exist. Please sign up.');
            }

            if (user.password !== password) {
                throw new Error('Incorrect password.');
            }

            if (!user.confirmed) {
                throw new Error('User account is not confirmed yet. Please verify your code.');
            }

            return {
                token: `mock-cognito-token-${Date.now()}`,
                username: user.name || user.email.split('@')[0],
                email: user.email
            };
        }
    }

    const cognitoAuth = new CognitoAuthService(CognitoConfig);

    // ============================================================
    //  STATE
    // ============================================================
    let products = [
        { id: 1, name: 'Wireless Headphones', category: 'Electronics', price: 79.99, stock: 12, emoji: '🎧' },
        { id: 2, name: 'Smart Watch', category: 'Electronics', price: 149.99, stock: 8, emoji: '⌚' },
        { id: 3, name: 'Running Shoes', category: 'Clothing', price: 89.99, stock: 15, emoji: '👟' },
        { id: 4, name: 'Hoodie', category: 'Clothing', price: 49.99, stock: 20, emoji: '🧥' },
        { id: 5, name: 'Coffee Mug', category: 'Home', price: 12.99, stock: 30, emoji: '☕' },
        { id: 6, name: 'Desk Lamp', category: 'Home', price: 34.99, stock: 10, emoji: '💡' },
        { id: 7, name: 'Fiction Novel', category: 'Books', price: 19.99, stock: 25, emoji: '📚' },
        { id: 8, name: 'Cookbook', category: 'Books', price: 24.99, stock: 18, emoji: '🍳' },
        { id: 9, name: 'Action Figure', category: 'Toys', price: 29.99, stock: 7, emoji: '🤖' },
        { id: 10, name: 'Puzzle Set', category: 'Toys', price: 15.99, stock: 14, emoji: '🧩' },
        { id: 11, name: 'Bluetooth Speaker', category: 'Electronics', price: 59.99, stock: 9, emoji: '🔊' },
        { id: 12, name: 'Backpack', category: 'Clothing', price: 39.99, stock: 11, emoji: '🎒' },
    ];
    let cart = [];
    let orders = [];
    let orderIdCounter = 1001;
    let currentUser = null;
    let pendingConfirmEmail = '';
    let deletingProductId = null;

    // ============================================================
    //  DOM REFS
    // ============================================================
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

    const loginPage = $('#loginPage');
    const app = $('#app');
    const authSubtitle = $('#authSubtitle');

    // Forms
    const loginForm = $('#loginForm');
    const signUpForm = $('#signUpForm');
    const confirmCodeForm = $('#confirmCodeForm');
    const forgotPasswordForm = $('#forgotPasswordForm');
    const confirmResetForm = $('#confirmResetForm');

    // Sign In inputs
    const usernameInput = $('#usernameInput');
    const passwordInput = $('#passwordInput');
    const loginError = $('#loginError');

    // Sign Up inputs
    const signUpNameInput = $('#signUpNameInput');
    const signUpEmailInput = $('#signUpEmailInput');
    const signUpPasswordInput = $('#signUpPasswordInput');
    const signUpError = $('#signUpError');

    // Confirm Code inputs
    const confirmEmailDisplay = $('#confirmEmailDisplay');
    const confirmCodeInput = $('#confirmCodeInput');
    const confirmCodeError = $('#confirmCodeError');
    const codeHint = $('#codeHint');

    // Forgot Password inputs
    const forgotEmailInput = $('#forgotEmailInput');
    const forgotPasswordError = $('#forgotPasswordError');

    // Reset Password inputs
    const resetEmailDisplay = $('#resetEmailDisplay');
    const resetCodeInput = $('#resetCodeInput');
    const newPasswordInput = $('#newPasswordInput');
    const confirmResetError = $('#confirmResetError');

    // Product Modal inputs
    const addProductBtn = $('#addProductBtn');
    const productModal = $('#productModal');
    const productModalTitle = $('#productModalTitle');
    const productForm = $('#productForm');
    const prodIdInput = $('#prodIdInput');
    const prodNameInput = $('#prodNameInput');
    const prodCategoryInput = $('#prodCategoryInput');
    const prodEmojiInput = $('#prodEmojiInput');
    const prodPriceInput = $('#prodPriceInput');
    const prodStockInput = $('#prodStockInput');
    const productModalCancel = $('#productModalCancel');

    // Delete Modal elements
    const deleteProductModal = $('#deleteProductModal');
    const deleteProdNameDisplay = $('#deleteProdNameDisplay');
    const deleteProductCancel = $('#deleteProductCancel');
    const deleteProductConfirm = $('#deleteProductConfirm');

    // Nav & Views
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

    // Modal & Toast
    const modal = $('#checkoutModal');
    const modalTotal = $('#modalTotal');
    const modalItemCount = $('#modalItemCount');
    const modalCancel = $('#modalCancel');
    const modalConfirm = $('#modalConfirm');
    const toastContainer = $('#toastContainer');

    // ============================================================
    //  TOAST NOTIFICATIONS
    // ============================================================
    function toast(message, type = 'info', duration = 3500) {
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
    //  LOCAL STORAGE PERSISTENCE
    // ============================================================
    function loadData() {
        try {
            const saved = localStorage.getItem('novashop_data');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.cart) cart = parsed.cart;
                if (parsed.orders) orders = parsed.orders;
                if (parsed.orderIdCounter) orderIdCounter = parsed.orderIdCounter;
                if (parsed.products) {
                    // Load full product array or merge custom added ones
                    products = parsed.products;
                }
                if (parsed.currentUser) currentUser = parsed.currentUser;
            }
        } catch (_) { /* ignore */ }
    }

    function saveData() {
        try {
            localStorage.setItem('novashop_data', JSON.stringify({
                cart,
                orders,
                orderIdCounter,
                products,
                currentUser,
            }));
        } catch (_) { /* ignore */ }
    }

    loadData();

    // ============================================================
    //  AUTH UI SWITCHING
    // ============================================================
    function switchAuthView(viewName) {
        [loginForm, signUpForm, confirmCodeForm, forgotPasswordForm, confirmResetForm].forEach(f => {
            if (f) f.classList.add('hidden');
        });

        [loginError, signUpError, confirmCodeError, forgotPasswordError, confirmResetError].forEach(e => {
            if (e) e.textContent = '';
        });

        if (viewName === 'signin') {
            authSubtitle.textContent = 'Sign in to manage your sales';
            loginForm.classList.remove('hidden');
        } else if (viewName === 'signup') {
            authSubtitle.textContent = 'Create a new Amazon Cognito account';
            signUpForm.classList.remove('hidden');
        } else if (viewName === 'confirm') {
            authSubtitle.textContent = 'Confirm your email verification code';
            confirmCodeForm.classList.remove('hidden');
        } else if (viewName === 'forgot') {
            authSubtitle.textContent = 'Reset your password via Cognito';
            forgotPasswordForm.classList.remove('hidden');
        } else if (viewName === 'reset') {
            authSubtitle.textContent = 'Enter verification code & new password';
            confirmResetForm.classList.remove('hidden');
        }
    }

    function showApp() {
        loginPage.style.display = 'none';
        app.classList.add('active');
        userNameSpan.textContent = currentUser.username.charAt(0).toUpperCase() + currentUser.username.slice(1);

        renderProducts();
        renderCart();
        renderDashboard();
        renderOrders();
        switchView('dashboard');
    }

    function showLogin() {
        loginPage.style.display = 'flex';
        app.classList.remove('active');
        switchAuthView('signin');
    }

    if (currentUser) {
        showApp();
    } else {
        showLogin();
    }

    // ============================================================
    //  AUTH EVENT HANDLERS
    // ============================================================

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        if (!username || !password) {
            loginError.textContent = 'Please fill in all fields.';
            return;
        }

        try {
            loginError.textContent = 'Authenticating...';
            const authResult = await cognitoAuth.signIn(username, password);
            currentUser = { username: authResult.username, email: authResult.email, token: authResult.token };
            saveData();
            showApp();
            loginError.textContent = '';
            toast(`Welcome back, ${currentUser.username}!`, 'success');
        } catch (err) {
            loginError.textContent = err.message || 'Invalid credentials';
            if (err.message.includes('not confirmed')) {
                pendingConfirmEmail = username;
                confirmEmailDisplay.textContent = pendingConfirmEmail;
                switchAuthView('confirm');
            }
        }
    });

    signUpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = signUpNameInput.value.trim();
        const email = signUpEmailInput.value.trim();
        const password = signUpPasswordInput.value.trim();

        if (!name || !email || !password) {
            signUpError.textContent = 'Please fill in all required fields.';
            return;
        }

        try {
            signUpError.textContent = 'Registering with Amazon Cognito...';
            const result = await cognitoAuth.signUp(email, password, name);
            pendingConfirmEmail = result.email;
            confirmEmailDisplay.textContent = pendingConfirmEmail;

            if (result.code) {
                codeHint.innerHTML = `<i class="fas fa-key"></i> Verification code sent: <code>${result.code}</code>`;
            } else {
                codeHint.textContent = '';
            }

            signUpError.textContent = '';
            toast(`Verification code sent to ${pendingConfirmEmail}!`, 'info');
            switchAuthView('confirm');
        } catch (err) {
            signUpError.textContent = err.message || 'Failed to sign up.';
        }
    });

    confirmCodeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = confirmCodeInput.value.trim();
        if (!code) {
            confirmCodeError.textContent = 'Please enter the verification code.';
            return;
        }

        try {
            confirmCodeError.textContent = 'Verifying code...';
            const res = await cognitoAuth.confirmSignUp(pendingConfirmEmail, code);
            confirmCodeError.textContent = '';

            const users = cognitoAuth.getMockUsers();
            const userObj = users[pendingConfirmEmail.toLowerCase()] || res.user || {};
            const username = userObj.name || pendingConfirmEmail.split('@')[0];

            currentUser = {
                username: username,
                email: pendingConfirmEmail,
                token: `cognito-token-${Date.now()}`
            };
            saveData();

            toast(`Account verified successfully! Welcome, ${username}!`, 'success');
            showApp();
        } catch (err) {
            confirmCodeError.textContent = err.message || 'Verification failed.';
        }
    });

    $('#resendCodeBtn').addEventListener('click', async (e) => {
        e.preventDefault();
        if (!pendingConfirmEmail) return;
        try {
            const res = await cognitoAuth.forgotPassword(pendingConfirmEmail);
            if (res.code) {
                codeHint.innerHTML = `<i class="fas fa-key"></i> New verification code sent: <code>${res.code}</code>`;
            }
            toast(`Resent verification code to ${pendingConfirmEmail}`, 'info');
        } catch (err) {
            confirmCodeError.textContent = err.message;
        }
    });

    forgotPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = forgotEmailInput.value.trim();
        if (!email) {
            forgotPasswordError.textContent = 'Please enter your email address.';
            return;
        }

        try {
            forgotPasswordError.textContent = 'Sending reset code...';
            const res = await cognitoAuth.forgotPassword(email);
            pendingConfirmEmail = email;
            resetEmailDisplay.textContent = pendingConfirmEmail;
            forgotPasswordError.textContent = '';

            toast(`Password reset code sent to ${email}`, 'info');
            switchAuthView('reset');
        } catch (err) {
            forgotPasswordError.textContent = err.message || 'Failed to send reset code.';
        }
    });

    confirmResetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = resetCodeInput.value.trim();
        const newPassword = newPasswordInput.value.trim();

        if (!code || !newPassword) {
            confirmResetError.textContent = 'Please enter the code and new password.';
            return;
        }

        try {
            confirmResetError.textContent = 'Resetting password...';
            await cognitoAuth.confirmForgotPassword(pendingConfirmEmail, code, newPassword);
            confirmResetError.textContent = '';

            toast('Password reset successfully! Please sign in with your new password.', 'success');
            usernameInput.value = pendingConfirmEmail;
            passwordInput.value = newPassword;
            switchAuthView('signin');
        } catch (err) {
            confirmResetError.textContent = err.message || 'Failed to reset password.';
        }
    });

    $('#toSignUpLink').addEventListener('click', (e) => { e.preventDefault(); switchAuthView('signup'); });
    $('#toForgotPasswordLink').addEventListener('click', (e) => { e.preventDefault(); switchAuthView('forgot'); });
    $('#toSignInFromSignUp').addEventListener('click', (e) => { e.preventDefault(); switchAuthView('signin'); });
    $('#toSignInFromConfirm').addEventListener('click', (e) => { e.preventDefault(); switchAuthView('signin'); });
    $('#toSignInFromForgot').addEventListener('click', (e) => { e.preventDefault(); switchAuthView('signin'); });
    $('#toSignInFromReset').addEventListener('click', (e) => { e.preventDefault(); switchAuthView('signin'); });

    signOutBtn.addEventListener('click', () => {
        currentUser = null;
        saveData();
        showLogin();
        toast('Signed out successfully.', 'info');
    });

    // ============================================================
    //  MAIN APPLICATION NAVIGATION
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
        productModal.classList.remove('open');
        deleteProductModal.classList.remove('open');
    }

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    $('#cartTrigger').addEventListener('click', () => switchView('cart'));

    // ============================================================
    //  PRODUCT MANAGEMENT (ADD, EDIT, DELETE)
    // ============================================================
    function openAddProductModal() {
        prodIdInput.value = '';
        prodNameInput.value = '';
        prodCategoryInput.value = 'Electronics';
        prodEmojiInput.value = '📦';
        prodPriceInput.value = '';
        prodStockInput.value = '';
        productModalTitle.innerHTML = '<i class="fas fa-box" style="color:var(--primary);margin-right:10px;"></i>Add New Product';
        productModal.classList.add('open');
    }

    window.openEditProductModal = function(id) {
        const product = products.find(p => p.id === id);
        if (!product) return;
        prodIdInput.value = product.id;
        prodNameInput.value = product.name;
        prodCategoryInput.value = product.category;
        prodEmojiInput.value = product.emoji || '📦';
        prodPriceInput.value = product.price;
        prodStockInput.value = product.stock;
        productModalTitle.innerHTML = '<i class="fas fa-edit" style="color:var(--primary);margin-right:10px;"></i>Edit Product';
        productModal.classList.add('open');
    };

    window.openDeleteProductModal = function(id) {
        const product = products.find(p => p.id === id);
        if (!product) return;
        deletingProductId = id;
        deleteProdNameDisplay.textContent = product.name;
        deleteProductModal.classList.add('open');
    };

    addProductBtn.addEventListener('click', openAddProductModal);
    productModalCancel.addEventListener('click', () => productModal.classList.remove('open'));
    deleteProductCancel.addEventListener('click', () => deleteProductModal.classList.remove('open'));

    productForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const idVal = prodIdInput.value;
        const name = prodNameInput.value.trim();
        const category = prodCategoryInput.value;
        const emoji = prodEmojiInput.value.trim() || '📦';
        const price = parseFloat(prodPriceInput.value);
        const stock = parseInt(prodStockInput.value, 10);

        if (!name || isNaN(price) || isNaN(stock)) {
            toast('Please fill in valid product details.', 'error');
            return;
        }

        if (idVal) {
            // Edit existing product
            const prodId = parseInt(idVal, 10);
            const product = products.find(p => p.id === prodId);
            if (product) {
                product.name = name;
                product.category = category;
                product.emoji = emoji;
                product.price = price;
                product.stock = stock;

                // Sync cart if present
                const cartItem = cart.find(c => c.id === prodId);
                if (cartItem) {
                    cartItem.name = name;
                    cartItem.price = price;
                    cartItem.emoji = emoji;
                    if (cartItem.qty > stock) cartItem.qty = stock;
                }
                toast(`Updated product "${name}"`, 'success');
            }
        } else {
            // Add new product
            const newId = products.length ? Math.max(...products.map(p => p.id)) + 1 : 1;
            const newProduct = { id: newId, name, category, price, stock, emoji };
            products.push(newProduct);
            toast(`Product "${name}" added successfully!`, 'success');
        }

        saveData();
        renderProducts(searchInput.value);
        renderCart();
        productModal.classList.remove('open');
    });

    deleteProductConfirm.addEventListener('click', () => {
        if (!deletingProductId) return;
        const product = products.find(p => p.id === deletingProductId);
        const name = product ? product.name : 'Product';

        products = products.filter(p => p.id !== deletingProductId);
        cart = cart.filter(c => c.id !== deletingProductId);

        deletingProductId = null;
        saveData();
        renderProducts(searchInput.value);
        renderCart();
        deleteProductModal.classList.remove('open');
        toast(`Deleted product "${name}"`, 'info');
    });

    // ============================================================
    //  PRODUCTS RENDER MODULE
    // ============================================================
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
            return `
                <div class="product-card">
                    <div class="card-header-actions">
                        <button class="btn-edit" title="Edit Product" onclick="openEditProductModal(${p.id})">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete" title="Delete Product" onclick="openDeleteProductModal(${p.id})">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                    <div class="emoji">${p.emoji}</div>
                    <div class="name">${p.name}</div>
                    <div class="category">${p.category}</div>
                    <div class="price">$${p.price.toFixed(2)}</div>
                    <div class="stock ${lowStock ? 'low' : ''}">${p.stock} in stock</div>
                    <div class="actions">
                        ${qtyInCart > 0 ? `
                            <button class="btn btn-outline btn-sm" onclick="updateCartQty(${p.id}, -1)">
                                <i class="fas fa-minus"></i>
                            </button>
                            <span style="font-weight:600;padding:0 4px;min-width:24px;text-align:center;">${qtyInCart}</span>
                            <button class="btn btn-outline btn-sm" onclick="updateCartQty(${p.id}, 1)" ${p.stock <= qtyInCart ? 'disabled' : ''}>
                                <i class="fas fa-plus"></i>
                            </button>
                        ` : `
                            <button class="btn btn-primary btn-sm" onclick="addToCart(${p.id})" ${p.stock <= 0 ? 'disabled' : ''}>
                                <i class="fas fa-cart-plus"></i> Add
                            </button>
                        `}
                    </div>
                </div>
            `;
        }).join('');
    }

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

    searchInput.addEventListener('input', () => renderProducts(searchInput.value));
    categoryFilter.addEventListener('change', () => renderProducts(searchInput.value));

    // ============================================================
    //  CART & CHECKOUT
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
                        <div class="price">$${item.price.toFixed(2)}</div>
                    </div>
                    <div class="qty-control">
                        <button onclick="updateCartQty(${item.id}, -1)"><i class="fas fa-minus"></i></button>
                        <span>${item.qty}</span>
                        <button onclick="updateCartQty(${item.id}, 1)" ${item.qty >= (products.find(p=>p.id===item.id)?.stock || 0) ? 'disabled' : ''}>
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <div class="item-total">$${total.toFixed(2)}</div>
                    <button class="remove-btn" onclick="updateCartQty(${item.id}, -${item.qty})"><i class="fas fa-trash-alt"></i></button>
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

    modalConfirm.addEventListener('click', () => {
        if (!cart.length) return;
        const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
        const tax = total * 0.10;
        const grand = total + tax;
        const order = {
            id: orderIdCounter++,
            items: cart.map(c => ({ ...c })),
            subtotal: total,
            tax: tax,
            total: grand,
            date: new Date().toISOString(),
            status: 'completed',
        };
        orders.push(order);

        cart.forEach(c => {
            const prod = products.find(p => p.id === c.id);
            if (prod) prod.stock = Math.max(0, prod.stock - c.qty);
        });

        cart = [];
        saveData();
        renderCart();
        renderProducts(searchInput.value);
        renderDashboard();
        renderOrders();
        modal.classList.remove('open');
        toast(`Order #${order.id} placed successfully! 🎉`, 'success');
        setTimeout(() => switchView('orders'), 500);
    });

    // ============================================================
    //  ORDERS MODULE
    // ============================================================
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
            const itemCount = o.items.reduce((s, i) => s + i.qty, 0);
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
    //  DASHBOARD MODULE
    // ============================================================
    function renderDashboard() {
        const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
        const totalOrders = orders.length;
        const totalSold = orders.reduce((sum, o) =>
            sum + o.items.reduce((s, i) => s + i.qty, 0), 0);
        const customers = orders.length;

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

    // Global helper
    window.switchView = switchView;
    window.cognitoAuth = cognitoAuth;

    window.addEventListener('beforeunload', saveData);

    console.log('🛒 NovaShop loaded with Product Management.');
})();
