'use strict';

const { bug } = require('../lib/bugs');
const { ApiError } = require('../lib/errors');

/** Calculate whole baht from the current services row and the quantity or area. */
function fee(serviceId, qtyOrArea, serviceRow) {
  const value = typeof qtyOrArea === 'string' ? Number(qtyOrArea) : qtyOrArea;

  switch (serviceId) {
    case 'SV-01':
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        throw new ApiError('INVALID_QTY');
      }
      return serviceRow.fee * value;
    case 'SV-02':
      return serviceRow.fee;
    case 'SV-03': {
      if (!Number.isInteger(value) || value < 1) {
        throw new ApiError('INVALID_AREA');
      }
      if (value > 500) throw new ApiError('AREA_TOO_LARGE');

      const chargeAbove = bug('B01') ? 101 : 100;
      const excess = value > chargeAbove ? value - 100 : 0;
      return serviceRow.fee + serviceRow.fee_per_sqm * excess;
    }
    default:
      throw new ApiError('BAD_REQUEST');
  }
}

module.exports = { fee };
