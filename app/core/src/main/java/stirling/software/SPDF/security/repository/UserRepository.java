package stirling.software.SPDF.security.repository;

import java.util.Optional;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingClass;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import stirling.software.SPDF.security.model.Role;
import stirling.software.SPDF.security.model.User;

@Repository
@ConditionalOnMissingClass(
        "stirling.software.proprietary.security.database.repository.UserRepository")
public interface UserRepository extends JpaRepository<User, String> {

    Optional<User> findByUsername(String username);

    Optional<User> findByLoginName(String loginName);

    boolean existsByUsername(String username);

    boolean existsByLoginName(String loginName);

    @Query(
            "SELECT u FROM User u WHERE "
                    + "(:search = '' OR LOWER(u.name) LIKE LOWER(CONCAT('%', :search, '%')) "
                    + "OR LOWER(u.username) LIKE LOWER(CONCAT('%', :search, '%')) "
                    + "OR LOWER(COALESCE(u.loginName, '')) LIKE LOWER(CONCAT('%', :search, '%')))")
    Page<User> findBySearch(@Param("search") String search, Pageable pageable);

    boolean existsByRole(Role role);

    long countByRole(Role role);
}
