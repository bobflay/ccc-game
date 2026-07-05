/* ============================================
   GÉNÉRATION DE DONNÉES FICTIVES
   ============================================ */

// Catégories et fournisseurs
const categories = [
    'Électronique', 'Vêtements', 'Maison & Jardin', 'Sports & Plein Air',
    'Beauté & Santé', 'Automobile', 'Jouets & Jeux', 'Alimentation & Boissons'
];

const suppliers = [
    'GlobalTech Inc', 'Prime Logistique', 'ExpressLivraison',
    'FiableProduits SA', 'RapidFret Corp', 'ConfiFourniture SARL'
];

// Générer 90 jours de données fictives
function generateMockData() {
    const data = [];
    const today = new Date();

    for (let i = 89; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);

        categories.forEach(category => {
            suppliers.forEach(supplier => {
                // Prévision de base avec variation saisonnière
                const seasonFactor = 1 + 0.2 * Math.sin((i / 30) * Math.PI);
                const baseForecast = 10000 + Math.random() * 5000;
                const forecast = Math.round(baseForecast * seasonFactor);

                // Ventes réelles avec écart de ~25% inférieur aux prévisions
                const varianceFactor = 0.70 + Math.random() * 0.10; // Entre 70% et 80% (moyenne ~75%)
                const actual = Math.round(forecast * varianceFactor);

                // Indice de prix (100 = base, simuler des changements de prix)
                const priceIndex = 100 + (i < 30 ? 5 : 0) + (Math.random() - 0.5) * 10;

                // Ruptures de stock (plus probables pour certaines catégories/périodes)
                const stockoutChance = category === 'Électronique' ? 0.15 : 0.08;
                const stockouts = Math.random() < stockoutChance ? Math.floor(Math.random() * 5) + 1 : 0;

                // Taux de retours (varie selon la catégorie)
                const baseReturns = category === 'Vêtements' ? 0.12 : 0.05;
                const returnsRate = baseReturns + (Math.random() - 0.5) * 0.04;

                // Taux de livraison à temps (varie selon le fournisseur)
                const supplierIndex = suppliers.indexOf(supplier);
                const baseOTR = 0.92 - supplierIndex * 0.02;
                const onTimeRate = Math.min(1, Math.max(0.7, baseOTR + (Math.random() - 0.5) * 0.1));

                // Coût logistique
                const logisticsCost = Math.round(actual * (0.05 + Math.random() * 0.03));

                data.push({
                    date: date.toISOString().split('T')[0],
                    dateObj: new Date(date),
                    category,
                    supplier,
                    forecast,
                    actual,
                    priceIndex: Math.round(priceIndex * 10) / 10,
                    stockouts,
                    returnsRate: Math.round(returnsRate * 1000) / 1000,
                    onTimeRate: Math.round(onTimeRate * 1000) / 1000,
                    logisticsCost
                });
            });
        });
    }

    return data;
}

// Générer les données fictives d'inventaire
function generateInventoryData() {
    const inventory = {};
    categories.forEach(cat => {
        inventory[cat] = {
            avgInventory: 50000 + Math.random() * 30000,
            cogs: 800000 + Math.random() * 400000
        };
    });
    return inventory;
}

const allData = generateMockData();
const inventoryData = generateInventoryData();

/* ============================================
   GESTION DE L'ÉTAT
   ============================================ */
let state = {
    dateRange: 7,
    category: 'all',
    supplier: 'all',
    negativeOnly: false
};

/* ============================================
   FILTRAGE ET CALCULS DES DONNÉES
   ============================================ */

function getFilteredData() {
    const today = new Date();
    const cutoffDate = new Date(today);
    cutoffDate.setDate(cutoffDate.getDate() - state.dateRange);

    let filtered = allData.filter(d => d.dateObj >= cutoffDate);

    if (state.category !== 'all') {
        filtered = filtered.filter(d => d.category === state.category);
    }

    if (state.supplier !== 'all') {
        filtered = filtered.filter(d => d.supplier === state.supplier);
    }

    if (state.negativeOnly) {
        // Grouper par date et filtrer les jours avec écart négatif
        const dailyTotals = {};
        filtered.forEach(d => {
            if (!dailyTotals[d.date]) {
                dailyTotals[d.date] = { forecast: 0, actual: 0 };
            }
            dailyTotals[d.date].forecast += d.forecast;
            dailyTotals[d.date].actual += d.actual;
        });

        const negativeDates = Object.keys(dailyTotals)
            .filter(date => dailyTotals[date].actual - dailyTotals[date].forecast < 0);

        filtered = filtered.filter(d => negativeDates.includes(d.date));
    }

    return filtered;
}

function calculateKPIs(data) {
    if (data.length === 0) {
        return {
            totalForecast: 0,
            totalActual: 0,
            forecastAccuracy: 0,
            variance: 0,
            variancePercent: 0,
            inventoryTurnover: 0,
            daysOfInventory: 0,
            onTimeDelivery: 0,
            stockouts: 0,
            returnsRate: 0,
            logisticsCost: 0
        };
    }

    const totalForecast = data.reduce((sum, d) => sum + d.forecast, 0);
    const totalActual = data.reduce((sum, d) => sum + d.actual, 0);
    const variance = totalActual - totalForecast;
    const variancePercent = totalForecast > 0 ? (variance / totalForecast) * 100 : 0;

    // Précision des prévisions: 1 - |réel - prévision| / prévision, plafonné 0-1
    const forecastAccuracy = totalForecast > 0
        ? Math.max(0, Math.min(1, 1 - Math.abs(variance) / totalForecast))
        : 0;

    // Métriques d'inventaire (agrégées)
    let totalCOGS = 0;
    let totalAvgInventory = 0;
    const uniqueCategories = [...new Set(data.map(d => d.category))];
    uniqueCategories.forEach(cat => {
        if (inventoryData[cat]) {
            totalCOGS += inventoryData[cat].cogs * (state.dateRange / 365);
            totalAvgInventory += inventoryData[cat].avgInventory;
        }
    });

    const inventoryTurnover = totalAvgInventory > 0 ? totalCOGS / totalAvgInventory : 0;
    const daysOfInventory = inventoryTurnover > 0 ? state.dateRange / inventoryTurnover : 0;

    // Livraison à temps (moyenne pondérée)
    const weightedOTD = data.reduce((sum, d) => sum + d.onTimeRate * d.actual, 0);
    const onTimeDelivery = totalActual > 0 ? weightedOTD / totalActual : 0;

    // Total des ruptures
    const stockouts = data.reduce((sum, d) => sum + d.stockouts, 0);

    // Taux de retours (moyenne pondérée)
    const weightedReturns = data.reduce((sum, d) => sum + d.returnsRate * d.actual, 0);
    const returnsRate = totalActual > 0 ? weightedReturns / totalActual : 0;

    // Coût logistique
    const logisticsCost = data.reduce((sum, d) => sum + d.logisticsCost, 0);

    return {
        totalForecast,
        totalActual,
        forecastAccuracy,
        variance,
        variancePercent,
        inventoryTurnover,
        daysOfInventory,
        onTimeDelivery,
        stockouts,
        returnsRate,
        logisticsCost
    };
}

function getCategoryVariance(data) {
    const byCategory = {};

    categories.forEach(cat => {
        byCategory[cat] = {
            forecast: 0,
            actual: 0,
            stockouts: 0,
            onTimeTotal: 0,
            count: 0
        };
    });

    data.forEach(d => {
        byCategory[d.category].forecast += d.forecast;
        byCategory[d.category].actual += d.actual;
        byCategory[d.category].stockouts += d.stockouts;
        byCategory[d.category].onTimeTotal += d.onTimeRate;
        byCategory[d.category].count++;
    });

    return Object.entries(byCategory).map(([category, stats]) => ({
        category,
        forecast: stats.forecast,
        actual: stats.actual,
        variance: stats.actual - stats.forecast,
        variancePercent: stats.forecast > 0 ? ((stats.actual - stats.forecast) / stats.forecast) * 100 : 0,
        stockouts: stats.stockouts,
        onTimeRate: stats.count > 0 ? stats.onTimeTotal / stats.count : 0
    })).sort((a, b) => a.variance - b.variance);
}

function getSupplierPerformance(data) {
    const bySupplier = {};

    suppliers.forEach(sup => {
        bySupplier[sup] = {
            onTimeTotal: 0,
            count: 0,
            defects: 0
        };
    });

    data.forEach(d => {
        bySupplier[d.supplier].onTimeTotal += d.onTimeRate;
        bySupplier[d.supplier].count++;
        bySupplier[d.supplier].defects += d.returnsRate * d.actual;
    });

    return Object.entries(bySupplier)
        .map(([supplier, stats]) => ({
            supplier,
            otdRate: stats.count > 0 ? stats.onTimeTotal / stats.count : 0,
            count: stats.count
        }))
        .sort((a, b) => b.otdRate - a.otdRate);
}

function getDailySales(data) {
    const daily = {};

    data.forEach(d => {
        if (!daily[d.date]) {
            daily[d.date] = { forecast: 0, actual: 0, logisticsCost: 0 };
        }
        daily[d.date].forecast += d.forecast;
        daily[d.date].actual += d.actual;
        daily[d.date].logisticsCost += d.logisticsCost;
    });

    return Object.entries(daily)
        .map(([date, stats]) => ({ date, ...stats }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

function generateInsights(data, kpis) {
    const insights = [];
    const categoryVariance = getCategoryVariance(data);

    // Calculer les tendances récentes
    const recentData = data.slice(-Math.floor(data.length / 3));
    const olderData = data.slice(0, Math.floor(data.length / 3));

    const recentStockouts = recentData.reduce((sum, d) => sum + d.stockouts, 0) / recentData.length;
    const olderStockouts = olderData.reduce((sum, d) => sum + d.stockouts, 0) / olderData.length;

    const recentOTD = recentData.reduce((sum, d) => sum + d.onTimeRate, 0) / recentData.length;
    const olderOTD = olderData.reduce((sum, d) => sum + d.onTimeRate, 0) / olderData.length;

    const recentReturns = recentData.reduce((sum, d) => sum + d.returnsRate, 0) / recentData.length;
    const olderReturns = olderData.reduce((sum, d) => sum + d.returnsRate, 0) / olderData.length;

    const recentPrice = recentData.reduce((sum, d) => sum + d.priceIndex, 0) / recentData.length;
    const olderPrice = olderData.reduce((sum, d) => sum + d.priceIndex, 0) / olderData.length;

    // Analyses basées sur des règles
    if (kpis.variance < 0 && recentStockouts > olderStockouts * 1.2) {
        insights.push({
            icon: '📦',
            title: 'Ruptures de Stock Réduisant les Ventes',
            description: `Les ruptures de stock ont augmenté de ${Math.round((recentStockouts/olderStockouts - 1) * 100)}% récemment, contribuant probablement à ${formatCurrency(Math.abs(kpis.variance))} de ventes perdues.`,
            impact: 'high'
        });
    }

    if (kpis.variance < 0 && recentPrice > olderPrice * 1.03) {
        insights.push({
            icon: '💰',
            title: 'Impact de l\'Augmentation des Prix',
            description: `L'indice de prix moyen a augmenté de ${Math.round((recentPrice/olderPrice - 1) * 100)}%, ce qui a pu réduire la demande et contribuer à l'écart négatif.`,
            impact: 'medium'
        });
    }

    if (recentOTD < olderOTD * 0.95) {
        insights.push({
            icon: '🚚',
            title: 'Retards de Livraison Détectés',
            description: `Le taux de livraison à temps est passé de ${(olderOTD * 100).toFixed(1)}% à ${(recentOTD * 100).toFixed(1)}%, affectant potentiellement la disponibilité des produits.`,
            impact: 'high'
        });
    }

    if (recentReturns > olderReturns * 1.15) {
        insights.push({
            icon: '↩️',
            title: 'Taux de Retours en Hausse',
            description: `Les retours ont augmenté de ${Math.round((recentReturns/olderReturns - 1) * 100)}%, suggérant des problèmes de qualité ou d'adéquation nécessitant une attention.`,
            impact: 'medium'
        });
    }

    // Analyses spécifiques aux catégories
    const worstCategory = categoryVariance[0];
    if (worstCategory && worstCategory.variance < 0) {
        insights.push({
            icon: '📊',
            title: `${worstCategory.category} Sous-Performant`,
            description: `Cette catégorie présente le plus grand écart négatif à ${formatCurrency(worstCategory.variance)} (${worstCategory.variancePercent.toFixed(1)}%).`,
            impact: 'medium'
        });
    }

    // Si aucun problème détecté
    if (insights.length === 0) {
        insights.push({
            icon: '✅',
            title: 'Performance Conforme',
            description: 'Aucune tendance négative significative détectée. Les indicateurs de la chaîne d\'approvisionnement sont dans les plages acceptables.',
            impact: 'low'
        });
    }

    return insights.slice(0, 3);
}

/* ============================================
   UTILITAIRES DE FORMATAGE
   ============================================ */

function formatCurrency(value) {
    const absValue = Math.abs(value);
    if (absValue >= 1000000) {
        return (value < 0 ? '-' : '') + (absValue / 1000000).toFixed(1) + ' M€';
    } else if (absValue >= 1000) {
        return (value < 0 ? '-' : '') + (absValue / 1000).toFixed(0) + ' K€';
    }
    return value.toFixed(0) + ' €';
}

function formatPercent(value) {
    return (value * 100).toFixed(1) + '%';
}

function formatNumber(value) {
    if (value >= 1000000) {
        return (value / 1000000).toFixed(1) + 'M';
    } else if (value >= 1000) {
        return (value / 1000).toFixed(0) + 'K';
    }
    return value.toFixed(0);
}

/* ============================================
   RENDU DES GRAPHIQUES (Canvas Vanilla)
   ============================================ */

function drawLineChart(canvasId, datasets, labels) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();

    // Définir la taille du canvas pour les écrans Retina
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 20, right: 20, bottom: 40, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Effacer le canvas
    ctx.clearRect(0, 0, width, height);

    if (datasets[0].data.length === 0) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Aucune donnée disponible', width / 2, height / 2);
        return;
    }

    // Trouver min/max sur tous les datasets
    let allValues = datasets.flatMap(d => d.data);
    let maxValue = Math.max(...allValues) * 1.1;
    let minValue = Math.min(0, Math.min(...allValues) * 0.9);

    // Dessiner les lignes de grille
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const y = padding.top + (chartHeight / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        // Étiquettes de l'axe Y
        const value = maxValue - ((maxValue - minValue) / gridLines) * i;
        ctx.fillStyle = '#6b7280';
        ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(formatCurrency(value), padding.left - 10, y + 4);
    }

    // Dessiner les étiquettes de l'axe X
    const labelStep = Math.ceil(labels.length / 8);
    labels.forEach((label, i) => {
        if (i % labelStep === 0) {
            const x = padding.left + (chartWidth / (labels.length - 1)) * i;
            ctx.fillStyle = '#6b7280';
            ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';
            const shortLabel = label.slice(5); // Retirer l'année
            ctx.fillText(shortLabel, x, height - padding.bottom + 20);
        }
    });

    // Dessiner les lignes
    datasets.forEach(dataset => {
        ctx.beginPath();
        ctx.strokeStyle = dataset.color;
        ctx.lineWidth = 2;

        dataset.data.forEach((value, i) => {
            const x = padding.left + (chartWidth / (dataset.data.length - 1)) * i;
            const y = padding.top + chartHeight - ((value - minValue) / (maxValue - minValue)) * chartHeight;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Dessiner les points
        dataset.data.forEach((value, i) => {
            const x = padding.left + (chartWidth / (dataset.data.length - 1)) * i;
            const y = padding.top + chartHeight - ((value - minValue) / (maxValue - minValue)) * chartHeight;

            ctx.beginPath();
            ctx.fillStyle = dataset.color;
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        });
    });
}

function drawBarChart(canvasId, data, labels, colors) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();

    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 20, right: 20, bottom: 80, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, width, height);

    if (data.length === 0) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Aucune donnée disponible', width / 2, height / 2);
        return;
    }

    const maxValue = Math.max(...data.map(Math.abs)) * 1.1;
    const minValue = Math.min(0, Math.min(...data) * 1.1);
    const range = maxValue - minValue;
    const barWidth = chartWidth / data.length * 0.7;
    const barGap = chartWidth / data.length * 0.3;
    const zeroY = padding.top + chartHeight - ((0 - minValue) / range) * chartHeight;

    // Dessiner la grille
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        const value = maxValue - (range / 5) * i;
        ctx.fillStyle = '#6b7280';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(formatCurrency(value), padding.left - 8, y + 4);
    }

    // Dessiner la ligne zéro
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(width - padding.right, zeroY);
    ctx.stroke();

    // Dessiner les barres
    data.forEach((value, i) => {
        const x = padding.left + (chartWidth / data.length) * i + barGap / 2;
        const barHeight = (Math.abs(value) / range) * chartHeight;
        const y = value >= 0 ? zeroY - barHeight : zeroY;

        ctx.fillStyle = colors[i];
        ctx.fillRect(x, y, barWidth, barHeight);

        // Étiquettes
        ctx.save();
        ctx.translate(x + barWidth / 2, height - padding.bottom + 10);
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = '#374151';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(labels[i].substring(0, 12), 0, 0);
        ctx.restore();
    });
}

function drawHorizontalBarChart(canvasId, data, labels) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();

    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 20, right: 50, bottom: 30, left: 120 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, width, height);

    if (data.length === 0) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Aucune donnée disponible', width / 2, height / 2);
        return;
    }

    const barHeight = chartHeight / data.length * 0.7;
    const barGap = chartHeight / data.length * 0.3;

    // Dessiner la grille
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const x = padding.left + (chartWidth / 4) * i;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, height - padding.bottom);
        ctx.stroke();

        ctx.fillStyle = '#6b7280';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText((i * 25) + '%', x, height - padding.bottom + 15);
    }

    // Dessiner les barres
    data.forEach((value, i) => {
        const y = padding.top + (chartHeight / data.length) * i + barGap / 2;
        const barLength = (value / 100) * chartWidth;

        // Fond de la barre
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(padding.left, y, chartWidth, barHeight);

        // Remplissage de la barre
        const color = value >= 95 ? '#10b981' : value >= 90 ? '#f59e0b' : '#ef4444';
        ctx.fillStyle = color;
        ctx.fillRect(padding.left, y, barLength, barHeight);

        // Étiquette
        ctx.fillStyle = '#374151';
        ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(labels[i].substring(0, 15), padding.left - 10, y + barHeight / 2 + 4);

        // Valeur
        ctx.fillStyle = '#374151';
        ctx.textAlign = 'left';
        ctx.fillText(value.toFixed(1) + '%', padding.left + barLength + 5, y + barHeight / 2 + 4);
    });
}

/* ============================================
   FONCTIONS DE MISE À JOUR DE L'UI
   ============================================ */

function updateKPIs(kpis) {
    // Prévisions Totales
    const forecastCard = document.getElementById('kpi-forecast');
    forecastCard.querySelector('.kpi-value').textContent = formatCurrency(kpis.totalForecast);

    // Réalisé Total
    const actualCard = document.getElementById('kpi-actual');
    actualCard.querySelector('.kpi-value').textContent = formatCurrency(kpis.totalActual);

    // Précision des Prévisions
    const accuracyCard = document.getElementById('kpi-accuracy');
    accuracyCard.querySelector('.kpi-value').textContent = formatPercent(kpis.forecastAccuracy);
    accuracyCard.className = 'kpi-card ' + (kpis.forecastAccuracy >= 0.95 ? 'positive' : kpis.forecastAccuracy < 0.85 ? 'negative' : '');

    // Écart
    const varianceCard = document.getElementById('kpi-variance');
    varianceCard.querySelector('.kpi-value').textContent = formatCurrency(kpis.variance);
    varianceCard.querySelector('.kpi-subtext').textContent = `${kpis.variancePercent >= 0 ? '+' : ''}${kpis.variancePercent.toFixed(1)}% d'écart`;
    varianceCard.className = 'kpi-card ' + (kpis.variance >= 0 ? 'positive' : 'negative');

    // Rotation des Stocks
    const turnoverCard = document.getElementById('kpi-turnover');
    turnoverCard.querySelector('.kpi-value').textContent = kpis.inventoryTurnover.toFixed(1) + 'x';

    // Jours de Stock
    const coverageCard = document.getElementById('kpi-coverage');
    coverageCard.querySelector('.kpi-value').textContent = Math.round(kpis.daysOfInventory);

    // Livraison à Temps
    const otdCard = document.getElementById('kpi-otd');
    otdCard.querySelector('.kpi-value').textContent = formatPercent(kpis.onTimeDelivery);
    otdCard.className = 'kpi-card ' + (kpis.onTimeDelivery >= 0.98 ? 'positive' : kpis.onTimeDelivery < 0.90 ? 'negative' : '');

    // Ruptures de Stock
    const stockoutsCard = document.getElementById('kpi-stockouts');
    stockoutsCard.querySelector('.kpi-value').textContent = formatNumber(kpis.stockouts);
    stockoutsCard.className = 'kpi-card ' + (kpis.stockouts === 0 ? 'positive' : kpis.stockouts > 50 ? 'negative' : '');

    // Taux de Retours
    const returnsCard = document.getElementById('kpi-returns');
    returnsCard.querySelector('.kpi-value').textContent = formatPercent(kpis.returnsRate);
    returnsCard.className = 'kpi-card ' + (kpis.returnsRate <= 0.05 ? 'positive' : kpis.returnsRate > 0.10 ? 'negative' : '');

    // Coût Logistique
    const logisticsCard = document.getElementById('kpi-logistics');
    logisticsCard.querySelector('.kpi-value').textContent = formatCurrency(kpis.logisticsCost);
}

function updateCharts(data) {
    const dailySales = getDailySales(data);
    const categoryVariance = getCategoryVariance(data);
    const supplierPerformance = getSupplierPerformance(data);

    // Graphique des ventes
    drawLineChart('salesChart', [
        { data: dailySales.map(d => d.forecast), color: '#3b82f6' },
        { data: dailySales.map(d => d.actual), color: '#10b981' }
    ], dailySales.map(d => d.date));

    // Graphique d'écart par catégorie
    const variances = categoryVariance.map(c => c.variance);
    const varColors = variances.map(v => v >= 0 ? '#10b981' : '#ef4444');
    drawBarChart('varianceChart', variances, categoryVariance.map(c => c.category), varColors);

    // Graphique de performance fournisseur
    drawHorizontalBarChart('supplierChart',
        supplierPerformance.map(s => s.otdRate * 100),
        supplierPerformance.map(s => s.supplier)
    );

    // Graphique du coût logistique
    drawLineChart('logisticsChart', [
        { data: dailySales.map(d => d.logisticsCost), color: '#f59e0b' }
    ], dailySales.map(d => d.date));
}

function updateInsights(data, kpis) {
    const insights = generateInsights(data, kpis);
    const container = document.getElementById('insightsContainer');

    container.innerHTML = insights.map(insight => `
        <div class="insight-card ${insight.impact === 'high' ? 'high-impact' : insight.impact === 'medium' ? 'medium-impact' : ''}">
            <span class="insight-icon">${insight.icon}</span>
            <div class="insight-content">
                <h4>${insight.title}</h4>
                <p>${insight.description}</p>
            </div>
        </div>
    `).join('');
}

function updateVarianceTable(data) {
    const categoryVariance = getCategoryVariance(data);
    const negativeVariance = categoryVariance.filter(c => c.variance < 0).slice(0, 5);
    const tbody = document.getElementById('varianceTableBody');

    if (negativeVariance.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #10b981;">Toutes les catégories ont un écart positif ou nul</td></tr>';
        return;
    }

    tbody.innerHTML = negativeVariance.map(cat => `
        <tr>
            <td>${cat.category}</td>
            <td>${formatCurrency(cat.forecast)}</td>
            <td>${formatCurrency(cat.actual)}</td>
            <td class="negative">${formatCurrency(cat.variance)}</td>
            <td class="negative">${cat.variancePercent.toFixed(1)}%</td>
            <td class="${cat.stockouts > 10 ? 'warning' : ''}">${cat.stockouts}</td>
            <td class="${cat.onTimeRate < 0.9 ? 'warning' : cat.onTimeRate >= 0.95 ? 'positive' : ''}">${(cat.onTimeRate * 100).toFixed(1)}%</td>
        </tr>
    `).join('');
}

function updateDashboard() {
    const filteredData = getFilteredData();
    const kpis = calculateKPIs(filteredData);

    updateKPIs(kpis);
    updateCharts(filteredData);
    updateInsights(filteredData, kpis);
    updateVarianceTable(filteredData);
}

/* ============================================
   GESTIONNAIRES D'ÉVÉNEMENTS
   ============================================ */

function initializeFilters() {
    // Remplir le menu déroulant des catégories
    const categorySelect = document.getElementById('categoryFilter');
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categorySelect.appendChild(option);
    });

    // Remplir le menu déroulant des fournisseurs
    const supplierSelect = document.getElementById('supplierFilter');
    suppliers.forEach(sup => {
        const option = document.createElement('option');
        option.value = sup;
        option.textContent = sup;
        supplierSelect.appendChild(option);
    });
}

function setupEventListeners() {
    // Boutons de plage de dates
    document.querySelectorAll('.date-range-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.date-range-selector button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.dateRange = parseInt(btn.dataset.days);
            updateDashboard();
        });
    });

    // Filtre de catégorie
    document.getElementById('categoryFilter').addEventListener('change', (e) => {
        state.category = e.target.value;
        updateDashboard();
    });

    // Filtre de fournisseur
    document.getElementById('supplierFilter').addEventListener('change', (e) => {
        state.supplier = e.target.value;
        updateDashboard();
    });

    // Bascule écart négatif
    document.getElementById('negativeVarianceToggle').addEventListener('change', (e) => {
        state.negativeOnly = e.target.checked;
        updateDashboard();
    });

    // Gestionnaire de redimensionnement pour les graphiques
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const filteredData = getFilteredData();
            updateCharts(filteredData);
        }, 250);
    });
}

/* ============================================
   INITIALISATION
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
    initializeFilters();
    setupEventListeners();
    updateDashboard();
});
