import ../../examples/commons.go

PaymentInstructionsData {

  // The list of accounts involved in potential transactions
  accounts[] {
    id string                         // Account identifier (case-sensitive)
    balance number                    // Current account balance
    currency string                   // Currency code (NGN, USD, GBP, GHS)
  }

  // Raw instruction string to parse and process
  instruction string<trim>                 // Must be a non-empty instruction string
}

