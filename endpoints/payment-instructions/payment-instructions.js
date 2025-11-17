const { createHandler } = require('@app-core/server');
const { appLogger } = require('@app-core/logger');
const paymentInstructionsService = require('@app/services/payment-instructions/payment-instructions');

module.exports = createHandler({
  path: '/payment-instructions',
  method: 'post',
  middlewares: [], // No authentication

  async onResponseEnd(rc, rs) {
    appLogger.info(
      {
        requestContext: rc,
        response: rs,
      },
      'payment-instructions-request-completed'
    );
  },

  async handler(rc, helpers) {
    const payload = rc.body;

    try {
      const serviceResponse = await paymentInstructionsService(payload);

      // Successful or pending transactions → HTTP 200
      if (serviceResponse.status === 'successful' || serviceResponse.status === 'pending') {
        return {
          status: helpers.http_statuses.HTTP_200_OK,
          data: serviceResponse,
        };
      }

      // All failed responses → HTTP 400
      return {
        status: helpers.http_statuses.HTTP_400_BAD_REQUEST,
        data: serviceResponse,
      };
    } catch (err) {
      // If the service throws a throwAppError, it is shaped already.
      // If it's an unexpected error, convert to safe response.

      if (err && err.isAppError) {
        return {
          status: helpers.http_statuses.HTTP_400_BAD_REQUEST,
          data: err.toResponseJSON(),
        };
      }

      // Unexpected technical error (never leak stack traces)
      return {
        status: helpers.http_statuses.HTTP_500_INTERNAL_SERVER_ERROR,
        data: {
          status: 'failed',
          status_reason: 'Internal server error',
          status_code: 'INTERNAL',
        },
      };
    }
  },
});
