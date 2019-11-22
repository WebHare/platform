# Appendix 2: Operator precedence
The following table lists the precedence of operators. Operators have the same
precedence as other operators in their group, and higher precedence than operators in
lower groups. Operators in the same group are evaluated left-to-right.

| Group | Operator | Name |
| --- | --- | --- |
| 1 | `TYPEID` | Get type of |
| 2 | `[ ]` | Array subscript (list element) |
| 2 | `.` | Record cell (record element) |
| 2 | `->` | Object member (object element) |
| 3 | `YIELD` | Generator yield expression |
| 4 | `+` | Unary positive  |
| 4 | `-` | Unary negative |
| 4 | `NOT` | Logical NOT |
| 4 | `BITNEG` | Binary negation |
| 4 | `*` | Multiplication |
| 4 | `/` | Division |
| 4 | `%` | Modulus |
| 5 | `+` | Addition |
| 5 | `-` | Subtraction |
| 6 | `BITLSHIFT` | Binary left shift |
| 6 | `BITRSHIFT` | Binary right shift |
| 7 | `BITAND` | Binary AND |
| 7 | `BITOR` | Binary OR |
| 7 | `BITXOR` | Binary XOR |
| 8 | `||` | String merge |
| 8 | `CONCAT` | Array merge |
| 9 | `=` | Is equal to |
| 9 | `>` |= Is greater than or equal to |
| 9 | `<=` | Is less than or equal to |
| 9 | `>` | Is greater than |
| 9 | `<` | Is less then |
| 9 | `<>` | Is not equal to |
| 9 | `!=` | Is not equal to |
| 9 | `LIKE` | Matches wildcard pattern |
| 9 | `IN` | Is contained in |
| 10 | `AND` | Logical AND |
| 10 | `OR` | Logical OR |
| 10 | `XOR` | Exclusive OR |
| 11 | `AWAIT` | Asynchronous function wait expression |
| 11 | `SELECT` | Array or table select |
| 12 | `:=` | Assignment |