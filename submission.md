Payment Instructions Parser – Submission Notes
=================================================

1️⃣ Overview
------------

This project implements a **Payment Instructions Parser API** using the provided Node.js backend template.

*   Parses payment instructions in **DEBIT** and **CREDIT** formats
    
*   Validates instructions against **business rules**
    
*   Executes transactions on provided accounts
  
*   Follows the template structure exactly
  
*   No modifications outside allowed folders

2️⃣ Features Implemented
------------------------

### Endpoint: POST /payment-instructions

**Request Body Example:**
```
{

"accounts": [

{"id": "a", "balance": 230, "currency": "USD"},

{"id": "b", "balance": 300, "currency": "USD"}

],

"instruction": "DEBIT 30 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b"

}
```

**Response Example – Success:**
```
{
  "type": "DEBIT",
  "amount": 30,
  "currency": "USD",
  "debit_account": "a",
  "credit_account": "b",
  "execute_by": null,
  "status": "successful",
  "status_reason": "Transaction executed successfully",
  "status_code": "AP00",
  "accounts": [
    {"id": "a", "balance": 200, "balance_before": 230, "currency": "USD"},
    {"id": "b", "balance": 330, "balance_before": 300, "currency": "USD"}
  ]
}
```
**Validation & Error Handling:**

*   Amount must be positive integer
    
*   Supported currencies: NGN, USD, GBP, GHS
    
*   Account existence, uniqueness, and ID format
    
*   Sufficient funds for debit account
    
*   Execution date handling (past, present, future)
    

3️⃣ Services
------------

**services/payment-instructions/parse-payment-instructions.js**

*   Main parser and executor service
    
*   Pure functions for:
    
    *   Instruction parsing (string methods only)
        
    *   Business rule validation
        
    *   Account balance updates
        
    *   Status code assignment
        

4️⃣ Messages
------------

**messages/payment-instructions.js**

*   Centralized messages for validation rules, errors, and status codes:


| Code | Message                                      |
|------|----------------------------------------------|
| AM01 | Amount must be a positive integer            |
| CU01 | Account currency mismatch                    |
| CU02 | Unsupported currency                         |
| AC01 | Insufficient funds                           |
| AC02 | Debit and credit accounts cannot be the same |
| AC03 | Account not found                            |
| AC04 | Invalid account ID format                    |
| DT01 | Invalid date format                          |
| SY01 | Missing required keyword                     |
| SY02 | Invalid keyword order                        |
| SY03 | Malformed instruction                        |
| AP00 | Transaction executed successfully            |
| AP02 | Transaction scheduled for future execution   |


**5️⃣ Specs**
------------

**Data Validation:** `specs/payment-instructions/data/parse-payment-instructions.go`

**Endpoint Specs:** `specs/payment-instructions/endpoint/parse-payment-instructions.endpoint.go`


**6️⃣ How to Run**
------------
**Install dependencies:**
```
npm install
```
**Start the server:**
```
node boostrap.js
```
**Test the endpoint:**
```
curl -X POST https://payment-instruction-parser.myradture.com/payment-instructions \
  -H "Content-Type: application/json" \
  -d '{
        "accounts": [
          {"id": "a", "balance": 230, "currency": "USD"},
          {"id": "b", "balance": 300, "currency": "USD"}
        ],
        "instruction": "DEBIT 30 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b"
      }'
```

7️⃣ Assumptions & Notes
-----------------------

*   No authentication or database required
    
*   Instruction parsing uses only string manipulation
    
*   Date comparison is in **UTC**
    
*   Returns **one validation error per transaction**
    
*   Template structure strictly followed


**8️⃣ Repository Structure**
-----------------------
```
├── endpoints/

│ └── payment-instructions/

│ └── parse-payment-instructions.js

├── messages/

│ └── payment-instructions.js

├── services/

│ └── payment-instructions/

│ └── parse-payment-instructions.js

├── specs/

│ └── payment-instructions/

│ ├── data/parse-payment-instructions.go

│ └── endpoint/parse-payment-instructions.endpoint.go

├── app.js

└── package.json
```

**9️⃣ Testing**
-----------------------

* Manual testing using curl or Postman

* Validated all business rules, syntax rules, and execution logic
