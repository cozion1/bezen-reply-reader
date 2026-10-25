-- Two local sources for the BEZEN reply reader (synthetic data, declared in README)
CREATE LIGHTNING DATABASE BEZEN_SALES DESCRIBE BY "BEZEN sales replies and CRM leads";

CREATE LIGHTNING FILESTORE TABLE leads FROM BEZEN_SALES FORMAT CSV OPTIONS (
  PATH "/home/zetaris/customer-data/shared/bezen/leads.csv",
  inferSchema "true",
  header "true"
);

CREATE LIGHTNING FILESTORE TABLE replies FROM BEZEN_SALES FORMAT CSV OPTIONS (
  PATH "/home/zetaris/customer-data/shared/bezen/replies.csv",
  inferSchema "true",
  header "true",
  multiLine "true",
  escape "\""
);

SELECT COUNT(*) AS n FROM BEZEN_SALES.replies;
