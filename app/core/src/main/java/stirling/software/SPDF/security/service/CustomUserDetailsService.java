package stirling.software.SPDF.security.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingClass;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;

import stirling.software.SPDF.security.repository.UserRepository;

@Service
@ConditionalOnMissingClass(
        "stirling.software.proprietary.security.service.CustomUserDetailsService")
@RequiredArgsConstructor
public class CustomUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        // Buscar primero por loginName, luego por email (username)
        return userRepository
                .findByLoginName(username)
                .or(() -> userRepository.findByUsername(username))
                .orElseThrow(
                        () -> new UsernameNotFoundException("Usuario no encontrado: " + username));
    }
}
