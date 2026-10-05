# Common-password blocklist

`common-passwords.txt` is an unmodified copy of SecLists `Passwords/Common-Credentials/10k-most-common.txt` at revision `913b327317496d062bcc7cace524aaad8a693be2`, retrieved 2026-10-03.

- Source: https://github.com/danielmiessler/SecLists/blob/913b327317496d062bcc7cace524aaad8a693be2/Passwords/Common-Credentials/10k-most-common.txt
- SHA-256: `68782d6a4a19a4768d5f15dd66bd534e7a33055cc755411e33f16d18c50fdcce`
- License: MIT; the upstream license from the same revision is retained in `common-passwords.LICENSE`.

Load nonempty lines as NFC strings and reject exact normalized-password matches. Do not lowercase passwords for blocklist matching. This bounded list does not detect every compromised password. Updates must retain a pinned source revision, license and checksum.
