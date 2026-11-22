'use strict';

module.exports = {
  ...require('./fee'),
  ...require('./sla'),
};

// Node 20/22 resolves an explicit test directory to its index.js entry point.
if (require.main === module) require('./rules.test');
