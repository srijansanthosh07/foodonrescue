CREATE OR REPLACE FUNCTION public.nearby_ngos(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  name text,
  org_name text,
  address text,
  lat double precision,
  lng double precision,
  distance_km double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL OR p_radius_km IS NULL OR p_radius_km <= 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.org_name,
    p.address,
    p.lat,
    p.lng,
    (
      6371.0 * 2.0 * asin(
        sqrt(
          power(sin(radians(p.lat - p_lat) / 2.0), 2)
          + cos(radians(p_lat)) * cos(radians(p.lat))
          * power(sin(radians(p.lng - p_lng) / 2.0), 2)
        )
      )
    ) AS distance_km
  FROM public.profiles AS p
  WHERE p.role = 'ngo'
    AND p.verification_status = 'verified'
    AND p.suspended = false
    AND p.lat IS NOT NULL
    AND p.lng IS NOT NULL
    AND p.lat BETWEEN -90 AND 90
    AND p.lng BETWEEN -180 AND 180
    AND (
      6371.0 * 2.0 * asin(
        sqrt(
          power(sin(radians(p.lat - p_lat) / 2.0), 2)
          + cos(radians(p_lat)) * cos(radians(p.lat))
          * power(sin(radians(p.lng - p_lng) / 2.0), 2)
        )
      )
    ) <= p_radius_km
  ORDER BY distance_km ASC, p.org_name ASC NULLS LAST, p.name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.nearby_ngos(double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nearby_ngos(double precision, double precision, double precision) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_profiles_ngo_nearby
  ON public.profiles (lat, lng)
  WHERE role = 'ngo' AND verification_status = 'verified' AND suspended = false;

CREATE OR REPLACE FUNCTION public.notify_nearby_ngos_on_donation_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, message, donation_id, read)
  SELECT
    ngo.id,
    'New donation nearby: ' || NEW.title,
    NEW.id,
    false
  FROM public.nearby_ngos(NEW.lat, NEW.lng) AS ngo;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_nearby_ngos_on_donation_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_notify_nearby_ngos_on_donation_insert ON public.donations;
CREATE TRIGGER trg_notify_nearby_ngos_on_donation_insert
  AFTER INSERT ON public.donations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_nearby_ngos_on_donation_insert();
