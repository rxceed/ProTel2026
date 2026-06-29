-- Migration to remove awd_lower_threshold_cm from irrigation_rule_profiles
ALTER TABLE mst.irrigation_rule_profiles DROP COLUMN IF EXISTS awd_lower_threshold_cm;
