/* THE SAME LINE, FOR THE SAME REASON. Not optional -- see RUN-ME-001's own note on this. */
set search_path = hopeloan, public;

/* =====================================================================================
   THE NEIGHBOUR'S NUMBER -- WHO TO ASK IF WE CAN'T REACH THE CUSTOMER.
   =====================================================================================
   "add neighbor no at customer service, they ask them who is near when we can't reach you,
   and not the guarantor, so we have alt no and neighbor no" -- customers already have their
   own mobile_alt (RUN-ME-001), asked later at team assessment. This is a DIFFERENT person
   entirely -- someone physically near the customer, not the customer's own second number
   and not the guarantor -- asked for up front at customer service, the same moment the
   customer's own mobile is taken. */
alter table customers add column if not exists neighbor_no text;
