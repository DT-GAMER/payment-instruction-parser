PaymentInstructionsRequest {
  path /payment-instructions
  method POST

  // Input body (validated by data spec)
  body {
    accounts[] {
      id string
      balance number
      currency string
    }
    instruction string<trim>
  }

  // -------------------------
  // SUCCESSFUL RESPONSE
  // -------------------------
  response.ok {
    http.code 200
    status successful
    message "Transaction executed successfully"

    data {
      type string                          // DEBIT | TRANSFER | PAY | SCHEDULE | etc.
      amount number                        // Parsed numeric amount
      currency string                      // Currency extracted from instruction
      debit_account string                 // Account losing money
      credit_account string                // Account receiving money
      execute_by number|null               // null or timestamp for SCHEDULE instructions

      status string                        // "successful"
      status_reason string                 // Human-readable status message
      status_code string                   // AP00, BL01, AC01, etc.

      accounts[] {
        id string
        balance number
        balance_before number
        currency string
      }
    }
  }

  // -------------------------
  // ERROR / FAILED RESPONSE
  // -------------------------
  response.error {
    http.code 400
    status failed
    message "Transaction failed"

    data {
      type string|null                     // Parsed or null
      amount number|null                   // Parsed or null
      currency string|null                 // Parsed or null
      debit_account string|null            // Parsed or null
      credit_account string|null           // Parsed or null
      execute_by number|null               // Parsed or null

      status string                        // "failed"
      status_reason string                 // Detailed reason for failure
      status_code string                   // Error code: SY03, CU02, BL01…

      // For parseable but failed transactions: return accounts with balances_before = balance
      // For unparseable instruction (SY03): return [] (empty array)
      accounts[]? {
        id string
        balance number
        balance_before number
        currency string
      }
    }
  }
}
