DELETE FROM pause_recoveries WHERE decision IS NULL AND EXISTS(
 SELECT 1 FROM deliveries d WHERE d.id=pause_recoveries.delivery_id AND d.error='예약 수정'
);
