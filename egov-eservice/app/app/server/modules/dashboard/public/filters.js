'use strict';

const dashboardFilters = document.getElementById('dashboard-filters');
dashboardFilters.addEventListener('change', () => dashboardFilters.requestSubmit());
